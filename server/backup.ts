import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, readdir, unlink, rename, chmod } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
export async function backupDatabase(
  databasePath: string,
  directory = join(dirname(databasePath), "backups"),
  keep = 14,
) {
  if (!Number.isInteger(keep) || keep < 1)
    throw Error("Backup retention must be at least 1");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `haru-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
  const finalPath = join(directory, name);
  const destination = finalPath + ".partial",
    source = new DatabaseSync(databasePath, { readOnly: true });
  try {
    await backup(source, destination);
  } finally {
    source.close();
  }
  const check = new DatabaseSync(destination, { readOnly: true });
  try {
    if (check.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw Error("Backup integrity verification failed");
  } finally {
    check.close();
  }
  await chmod(destination, 0o600);
  await rename(destination, finalPath);
  const owned = (await readdir(directory))
    .filter((n) => /^haru-\d{4}-\d{2}-\d{2}T[\d-]+Z\.sqlite$/.test(n))
    .sort()
    .reverse();
  for (const expired of owned.slice(keep))
    await unlink(join(directory, expired));
  return finalPath;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const path = process.env.DATABASE_PATH || resolve("data/haru.sqlite");
  console.log(
    "Verified database backup:",
    await backupDatabase(path, process.env.BACKUP_DIRECTORY),
  );
}
