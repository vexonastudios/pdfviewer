const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

module.exports = function createVault(directory, safeStorage, atomicWrite) {
  const hash = value => createHash('sha256').update(value).digest('hex');
  async function read(file) { return JSON.parse(safeStorage.decryptString(await fs.readFile(file))); }
  async function write(file, record) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is unavailable. Recovery could not be saved.');
    await atomicWrite(file, safeStorage.encryptString(JSON.stringify(record)));
  }
  function target(kind, id) {
    if (!['recovery', 'history'].includes(kind) || !/^[a-f0-9-]+$/.test(id)) throw new Error('Invalid recovery item.');
    return path.join(directory, kind, `${id}.enc`);
  }
  async function list(kind) {
    const files = await fs.readdir(path.join(directory, kind)).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const entries = await Promise.all(files.filter(name => /^[a-f0-9-]+\.enc$/.test(name)).map(async name => {
      try { return { ...await read(path.join(directory, kind, name)), id: name.slice(0, -4) }; } catch { return null; }
    }));
    return entries.filter(Boolean).sort((a, b) => b.time - a.time);
  }
  return {
    async snapshot(record) {
      const id = hash(record.sourcePath || record.documentId);
      await write(target('recovery', id), { ...record, time: Date.now() });
      return id;
    },
    async clear(source) { await fs.rm(target('recovery', hash(source)), { force: true }); },
    async list(kind) { return (await list(kind)).map(({ bytes, ...record }) => record); },
    async restore(kind, id) { return read(target(kind, id)); },
    async remove(kind, id) { await fs.rm(target(kind, id), { force: true }); },
    async backup(file) {
      const bytes = await fs.readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!bytes) return;
      const source = path.resolve(file), id = `${hash(source)}-${randomUUID()}`;
      await write(target('history', id), { name: path.basename(source), sourcePath: source, time: Date.now(), bytes: bytes.toString('base64') });
      const records = await list('history');
      let count = 0;
      for (const record of records) if (record.sourcePath === source && ++count > 5 || records.indexOf(record) >= 100) await fs.rm(target('history', record.id), { force: true });
    },
  };
};
