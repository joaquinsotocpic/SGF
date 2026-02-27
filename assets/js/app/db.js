// DB helper for sql.js Database (SGF.sqlDb)
// - select(): devuelve array de objetos
// - run(): ejecuta SQL con params
// - save(): persiste la bóveda (export + cifrado + IndexedDB)

(function () {
  window.SGF = window.SGF || {};

  function ensureDb() {
    const db = window.SGF.sqlDb;
    if (!db) throw new Error('Base no abierta. Inicia sesión primero.');
    return db;
  }


  function isNotADbError(err) {
    const msg = String(err?.message || err || '');
    return msg.includes('file is not a database') || msg.includes('SQLITE_NOTADB') || msg.toLowerCase().includes('notadb');
  }

  function healSqlDbOnce() {
    const db = window.SGF.sqlDb;
    const SQL = window.SGF?.vault?.SQL || window.SGF.SQL;
    if (!db || !SQL || typeof db.export !== 'function') return false;

    try {
      const bytes = db.export();
      try { db.close?.(); } catch (_) {}
      const fresh = new SQL.Database(bytes);
      // PRAGMAs por conexión
      try { fresh.exec('PRAGMA foreign_keys = ON;'); } catch (_) {}
      window.SGF.sqlDb = fresh;
      return true;
    } catch (e) {
      console.warn('healSqlDbOnce fallo', e);
      return false;
    }
  }

  function withDbHeal(fn) {
    try {
      return fn();
    } catch (e) {
      if (isNotADbError(e) && healSqlDbOnce()) {
        // Reintento una sola vez
        return fn();
      }
      throw e;
    }
  }

  function toRows(res) {
    if (!res || !Array.isArray(res) || res.length === 0) return [];
    const { columns, values } = res[0];
    return (values || []).map(v => {
      const row = {};
      for (let i = 0; i < columns.length; i++) row[columns[i]] = v[i];
      return row;
    });
  }

  function select(sql, params = {}) {
    return withDbHeal(() => {
      const db = ensureDb();
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        try { stmt.free(); } catch (_) {}
      }
    });
  }

  function run(sql, params = {}) {
    return withDbHeal(() => {
      const db = ensureDb();
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params);
        stmt.step();
        return (typeof db.getRowsModified === 'function') ? db.getRowsModified() : 0;
      } finally {
        try { stmt.free(); } catch (_) {}
      }
    });
  }

  function scalar(sql, params = {}) {
    return withDbHeal(() => {
      const rows = select(sql, params);
      if (!rows || !rows.length) return null;
      const keys = Object.keys(rows[0] || {});
      return keys.length ? rows[0][keys[0]] : null;
    });
  }

  async function save() {
    if (!window.SGF?.vault?.saveCurrent) {
      throw new Error('saveCurrent no está disponible.');
    }
    await window.SGF.vault.saveCurrent();
  }

  window.SGF.db = { select, run, scalar, save, toRows };
  // Aliases de compatibilidad: algunos módulos usan all/one.
  // Mantenerlos aquí evita fallos silenciosos en pantallas nuevas.
  window.SGF.db.all = select;
  window.SGF.db.one = function (sql, params = {}) {
    const rows = select(sql, params);
    return rows && rows.length ? rows[0] : null;
  };
})();
