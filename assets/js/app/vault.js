// SGF Vault (Gate): sql.js + CryptoJS + IndexedDB
// - Crea/abre una base SQLite por usuario
// - Cifra/descifra el archivo DB con contraseña (bóveda)
// - Auto-backups cifrados (local) y restauración

(function () {
  window.SGF = window.SGF || {};

  const VAULT_IDB_NAME = 'SGF_VAULT_IDB';
  const VAULT_IDB_VERSION = 3; // v3: vaults + backups + indexes
  const VAULT_STORE = 'vaults';
  const BACKUP_STORE = 'backups';
  const MAX_AUTO_BACKUPS = 10;

  // --- Utilidades de conversión ---
  function u8ToWordArray(u8arr) {
    const words = [];
    for (let i = 0; i < u8arr.length; i += 4) {
      words.push(
        ((u8arr[i] || 0) << 24) |
        ((u8arr[i + 1] || 0) << 16) |
        ((u8arr[i + 2] || 0) << 8) |
        ((u8arr[i + 3] || 0) << 0)
      );
    }
    return CryptoJS.lib.WordArray.create(words, u8arr.length);
  }

  function wordArrayToU8(wordArray) {
    const { words, sigBytes } = wordArray;
    const u8 = new Uint8Array(sigBytes);
    let idx = 0;
    for (let i = 0; i < sigBytes; i++) {
      const word = words[(i / 4) | 0];
      u8[idx++] = (word >> (24 - (i % 4) * 8)) & 0xff;
    }
    return u8;
  }

  function b64ToWordArray(b64) {
    return CryptoJS.enc.Base64.parse(b64);
  }

  function wordArrayToB64(wa) {
    return CryptoJS.enc.Base64.stringify(wa);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function safeUserFilename(u) {
    return String(u || 'sgf').replace(/[^a-z0-9_-]/gi, '_');
  }

  function uuid() {
    try {
      if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch (_) {}
    // fallback
    return 'b_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
  }

  // --- IndexedDB ---
  function openVaultIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(VAULT_IDB_NAME, VAULT_IDB_VERSION);
      const timer = setTimeout(() => {
        try { reject(new Error('IndexedDB no respondió. Cierra otras pestañas del SGF e intenta de nuevo.')); } catch (_) {}
      }, 5000);
      req.onblocked = () => {
        clearTimeout(timer);
        reject(new Error('IndexedDB está bloqueado por otra pestaña/ventana del SGF. Cierra las otras pestañas y vuelve a intentar.'));
      };
      req.onupgradeneeded = (e) => {
        const db = req.result;

        if (!db.objectStoreNames.contains(VAULT_STORE)) {
          db.createObjectStore(VAULT_STORE, { keyPath: 'username' });
        }

        if (!db.objectStoreNames.contains(BACKUP_STORE)) {
          const store = db.createObjectStore(BACKUP_STORE, { keyPath: 'id' });
          store.createIndex('username', 'username', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        } else {
          // Asegurar índices
          const store = e.target.transaction.objectStore(BACKUP_STORE);
          if (!store.indexNames.contains('username')) store.createIndex('username', 'username', { unique: false });
          if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => { clearTimeout(timer); const db = req.result; try { db.onversionchange = () => { try { db.close(); } catch (_) {} }; } catch (_) {} resolve(db); };
      req.onerror = () => { clearTimeout(timer); reject(req.error); };
    });
  }

  async function idbGetVault(username) {
    const idb = await openVaultIDB();
    return new Promise((resolve, reject) => {
      let result = null;
      const tx = idb.transaction(VAULT_STORE, 'readonly');
      const req = tx.objectStore(VAULT_STORE).get(username);
      req.onsuccess = () => { result = req.result || null; };
      req.onerror = () => { try { idb.close(); } catch (_) {} reject(req.error); };
      tx.oncomplete = () => { try { idb.close(); } catch (_) {} resolve(result); };
      tx.onerror = () => { try { idb.close(); } catch (_) {} reject(tx.error); };
    });
  }

  async function idbPutVault(record) {
    const idb = await openVaultIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(VAULT_STORE, 'readwrite');
      tx.objectStore(VAULT_STORE).put(record);
      tx.oncomplete = () => { try { idb.close(); } catch (_) {} resolve(true); };
      tx.onerror = () => { try { idb.close(); } catch (_) {} reject(tx.error); };
    });
  }

  async function idbDeleteVault(username) {
    const idb = await openVaultIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(VAULT_STORE, 'readwrite');
      tx.objectStore(VAULT_STORE).delete(username);
      tx.oncomplete = () => { try { idb.close(); } catch (_) {} resolve(true); };
      tx.onerror = () => { try { idb.close(); } catch (_) {} reject(tx.error); };
    });
  }

  async function idbListUsers() {
    const idb = await openVaultIDB();
    return new Promise((resolve, reject) => {
      let result = [];
      const tx = idb.transaction(VAULT_STORE, 'readonly');
      const req = tx.objectStore(VAULT_STORE).getAllKeys();
      req.onsuccess = () => { result = req.result || []; };
      req.onerror = () => { try { idb.close(); } catch (_) {} reject(req.error); };
      tx.oncomplete = () => { try { idb.close(); } catch (_) {} resolve(result); };
      tx.onerror = () => { try { idb.close(); } catch (_) {} reject(tx.error); };
    });
  }

  async function idbClearAll() {
    const idb = await openVaultIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction([VAULT_STORE, BACKUP_STORE], 'readwrite');
      tx.objectStore(VAULT_STORE).clear();
      tx.objectStore(BACKUP_STORE).clear();
      tx.oncomplete = () => { try { idb.close(); } catch (_) {} resolve(true); };
      tx.onerror = () => { try { idb.close(); } catch (_) {} reject(tx.error); };
    });
  }

  async function idbPutBackup(record) {
    const idb = await openVaultIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(BACKUP_STORE, 'readwrite');
      tx.objectStore(BACKUP_STORE).put(record);
      tx.oncomplete = () => { try { idb.close(); } catch (_) {} resolve(true); };
      tx.onerror = () => { try { idb.close(); } catch (_) {} reject(tx.error); };
    });
  }

  async function idbGetBackup(id) {
    const idb = await openVaultIDB();
    return new Promise((resolve, reject) => {
      let result = null;
      const tx = idb.transaction(BACKUP_STORE, 'readonly');
      const req = tx.objectStore(BACKUP_STORE).get(id);
      req.onsuccess = () => { result = req.result || null; };
      req.onerror = () => { try { idb.close(); } catch (_) {} reject(req.error); };
      tx.oncomplete = () => { try { idb.close(); } catch (_) {} resolve(result); };
      tx.onerror = () => { try { idb.close(); } catch (_) {} reject(tx.error); };
    });
  }

  async function idbDeleteBackup(id) {
    const idb = await openVaultIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(BACKUP_STORE, 'readwrite');
      tx.objectStore(BACKUP_STORE).delete(id);
      tx.oncomplete = () => { try { idb.close(); } catch (_) {} resolve(true); };
      tx.onerror = () => { try { idb.close(); } catch (_) {} reject(tx.error); };
    });
  }

  async function idbListBackups(username) {
    const idb = await openVaultIDB();
    return new Promise((resolve, reject) => {
      let rows = [];
      const tx = idb.transaction(BACKUP_STORE, 'readonly');
      const store = tx.objectStore(BACKUP_STORE);
      const idx = store.index('username');
      const req = idx.getAll(IDBKeyRange.only(String(username)));
      req.onsuccess = () => {
        rows = Array.isArray(req.result) ? req.result : [];
        rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      };
      req.onerror = () => { try { idb.close(); } catch (_) {} reject(req.error); };
      tx.oncomplete = () => { try { idb.close(); } catch (_) {} resolve(rows); };
      tx.onerror = () => { try { idb.close(); } catch (_) {} reject(tx.error); };
    });
  }

  async function idbDeleteBackupsForUser(username) {
    const rows = await idbListBackups(username);
    for (const r of rows) {
      try { await idbDeleteBackup(r.id); } catch (_) {}
    }
  }

  async function pruneAutoBackups(username) {
    const rows = await idbListBackups(username);
    const auto = rows.filter(r => String(r.label || '') === 'auto');
    if (auto.length <= MAX_AUTO_BACKUPS) return;
    const toDelete = auto.slice(MAX_AUTO_BACKUPS);
    for (const r of toDelete) {
      try { await idbDeleteBackup(r.id); } catch (_) {}
    }
  }

  // --- Crypto (AES-CBC + PBKDF2) ---
  function deriveKey(password, saltWA) {
    return CryptoJS.PBKDF2(password, saltWA, {
      keySize: 256 / 32,
      iterations: 100000,
      hasher: CryptoJS.algo.SHA256,
    });
  }

  function encryptBytes(bytesU8, password) {
    const salt = CryptoJS.lib.WordArray.random(16);
    const iv = CryptoJS.lib.WordArray.random(16);
    const key = deriveKey(password, salt);
    const plainWA = u8ToWordArray(bytesU8);
    const cipherParams = CryptoJS.AES.encrypt(plainWA, key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    return {
      saltB64: wordArrayToB64(salt),
      ivB64: wordArrayToB64(iv),
      cipherB64: wordArrayToB64(cipherParams.ciphertext),
    };
  }

  function decryptBytes({ saltB64, ivB64, cipherB64 }, password) {
    const salt = b64ToWordArray(saltB64);
    const iv = b64ToWordArray(ivB64);
    const key = deriveKey(password, salt);

    const cipherWA = b64ToWordArray(cipherB64);
    const decryptedWA = CryptoJS.AES.decrypt({ ciphertext: cipherWA }, key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    if (!decryptedWA || decryptedWA.sigBytes <= 0) {
      throw new Error('No se pudo descifrar: contraseña incorrecta o bóveda corrupta.');
    }
    return wordArrayToU8(decryptedWA);
  }


  function isSqliteBytes(u8) {
    try {
      if (!u8 || u8.length < 16) return false;
      const header = String.fromCharCode.apply(null, Array.from(u8.slice(0, 16)));
      return header === 'SQLite format 3\u0000';
    } catch (_) {
      return false;
    }
  }


  // --- SQLite schema base ---
  function createBaseSchema(db) {
    const sql = `
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 1;

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO meta(key,value) VALUES ('schema','1');

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exchange_rates (
        rate_date TEXT PRIMARY KEY,
        from_currency TEXT NOT NULL,
        to_currency TEXT NOT NULL,
        rate REAL NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        is_base INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type_id INTEGER,
        parent_id INTEGER,
        currency TEXT NOT NULL DEFAULT 'CRC',
        color TEXT,
        initial_balance REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        allow_negative INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(type_id) REFERENCES account_types(id),
        FOREIGN KEY(parent_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER,
        color TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY(parent_id) REFERENCES categories(id)
      );

      CREATE TABLE IF NOT EXISTS movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        date TEXT NOT NULL,
        period TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        account_to_id INTEGER,
        category_id INTEGER,
        amount REAL NOT NULL,
        description TEXT,
        reference_url TEXT,
        attachments_text TEXT,
        is_split INTEGER NOT NULL DEFAULT 0,
        is_savings INTEGER NOT NULL DEFAULT 0,
        savings_kind TEXT,
        goal_id INTEGER,
        savings_ref_id INTEGER,
        is_opening INTEGER NOT NULL DEFAULT 0,
        is_recurring INTEGER NOT NULL DEFAULT 0,
        recurring_id INTEGER,
        generated_period TEXT,
        currency TEXT NOT NULL DEFAULT 'CRC',
        fx_rate REAL NOT NULL DEFAULT 1,
        amount_to REAL,
        base_amount REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        FOREIGN KEY(account_id) REFERENCES accounts(id),
        FOREIGN KEY(account_to_id) REFERENCES accounts(id),
        FOREIGN KEY(category_id) REFERENCES categories(id)
      );

      CREATE TABLE IF NOT EXISTS movement_splits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movement_id INTEGER NOT NULL,
        category_id INTEGER,
        amount REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(movement_id) REFERENCES movements(id) ON DELETE CASCADE,
        FOREIGN KEY(category_id) REFERENCES categories(id)
      );

      CREATE TABLE IF NOT EXISTS savings_goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CRC',
        target REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS reconciliations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        bank_ending REAL NOT NULL DEFAULT 0,
        closed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        UNIQUE(period, account_id),
        FOREIGN KEY(account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS reconciliation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reconciliation_id INTEGER NOT NULL,
        movement_id INTEGER NOT NULL,
        is_ok INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        UNIQUE(reconciliation_id, movement_id),
        FOREIGN KEY(reconciliation_id) REFERENCES reconciliations(id) ON DELETE CASCADE,
        FOREIGN KEY(movement_id) REFERENCES movements(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period TEXT NOT NULL,
        type TEXT NOT NULL,
        category_id INTEGER,
        currency TEXT NOT NULL DEFAULT 'CRC',
        amount REAL NOT NULL,
        is_recurring INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        UNIQUE(period, type, category_id, currency, is_recurring),
        FOREIGN KEY(category_id) REFERENCES categories(id)
      );

      CREATE TABLE IF NOT EXISTS recurring_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        account_to_id INTEGER,
        category_id INTEGER,
        amount REAL NOT NULL,
        description TEXT,
        day INTEGER NOT NULL DEFAULT 1,
        frequency TEXT NOT NULL DEFAULT 'mensual',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(account_id) REFERENCES accounts(id),
        FOREIGN KEY(account_to_id) REFERENCES accounts(id),
        FOREIGN KEY(category_id) REFERENCES categories(id)
      );

      CREATE INDEX IF NOT EXISTS idx_movements_period ON movements(period);
      CREATE INDEX IF NOT EXISTS idx_movements_account ON movements(account_id);
      CREATE INDEX IF NOT EXISTS idx_movements_account_to ON movements(account_to_id);
      CREATE INDEX IF NOT EXISTS idx_movements_category ON movements(category_id);
      CREATE INDEX IF NOT EXISTS idx_recon_period ON reconciliations(period);
      CREATE INDEX IF NOT EXISTS idx_budget_period ON budgets(period);
    `;
    db.exec(sql);
  }

  // --- API pública ---
  const vault = {
    isReady: false,
    SQL: null,

    async initSql() {
      if (vault.isReady) return true;
      if (typeof initSqlJs !== 'function') throw new Error('sql.js no está cargado.');
      const SQL = await initSqlJs({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${file}`,
      });
      vault.SQL = SQL;
      window.SGF.SQL = SQL;
      vault.isReady = true;
      return true;
    },

    async createUser(username, password, { overwrite = false } = {}) {
      username = String(username || '').trim();
      if (!username || !password) throw new Error('Usuario y contraseña son requeridos.');
      await vault.initSql();

      const existing = await idbGetVault(username);
      if (existing && !overwrite) throw new Error('El usuario ya existe en este dispositivo.');
      if (existing && overwrite) {
        await idbDeleteVault(username);
        await idbDeleteBackupsForUser(username);
      }

      let db;
      try {
        db = new vault.SQL.Database();
        createBaseSchema(db);
        try { db.exec('PRAGMA foreign_keys = ON;'); } catch (_) {}
      } catch (e) {
        try {
          db = new vault.SQL.Database();
          createBaseSchema(db);
        try { db.exec('PRAGMA foreign_keys = ON;'); } catch (_) {}
        } catch (e2) {
          throw new Error('No se pudo crear la base SQLite local.');
        }
      }

      const bytes = db.export();
      if (!isSqliteBytes(bytes)) throw new Error('No se pudo guardar: base en memoria corrupta.');
      const enc = encryptBytes(bytes, password);
      const record = {
        username,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        schemaVersion: 1,
        ...enc,
      };
      await idbPutVault(record);

      // Abrir sesión
      window.SGF.session = { username };
      window.SGF.session.password = password;
      window.SGF.sqlDb = db;
      return true;
    },

    async openUser(username, password) {
      username = String(username || '').trim();
      if (!username || !password) throw new Error('Usuario y contraseña son requeridos.');
      await vault.initSql();

      const record = await idbGetVault(username);
      if (!record) throw new Error('Usuario no existe en este dispositivo.');

      const bytes = decryptBytes(record, password);
      if (!isSqliteBytes(bytes)) {
        throw new Error('No se pudo abrir: contraseña incorrecta o bóveda corrupta.');
      }

      let db;
      try {
        db = new vault.SQL.Database(bytes);
      } catch (e) {
        throw new Error('No se pudo abrir: contraseña incorrecta o bóveda corrupta.');
      }
      try { db.exec('PRAGMA foreign_keys = ON;'); } catch (_) {}

      window.SGF.session = { username };
      window.SGF.session.password = password;
      window.SGF.sqlDb = db;
      return true;
    },

    async saveCurrent({ reason = 'manual' } = {}) {
      const username = window.SGF?.session?.username;
      const password = window.SGF?.session?.password;
      const db = window.SGF?.sqlDb;
      if (!username || !password || !db) throw new Error('No hay sesión activa para guardar.');

      const existing = await idbGetVault(username);
      if (!existing) throw new Error('No existe bóveda para este usuario.');

      const bytes = db.export();
      if (!isSqliteBytes(bytes)) throw new Error('No se pudo guardar: base en memoria corrupta.');
      const enc = encryptBytes(bytes, password);
      const record = {
        ...existing,
        updatedAt: nowIso(),
        ...enc,
      };
      await idbPutVault(record);

      // Auto-backup (si está habilitado en config)
      try {
        const auto = Number(window.SGF.db?.scalar?.("SELECT value FROM config WHERE key='autoBackup'", {}) || 0);
        if (auto === 1) {
          const b = {
            id: uuid(),
            username,
            label: 'auto',
            createdAt: nowIso(),
            schemaVersion: record.schemaVersion,
            saltB64: record.saltB64,
            ivB64: record.ivB64,
            cipherB64: record.cipherB64,
          };
          await idbPutBackup(b);
          await pruneAutoBackups(username);
        }
      } catch (_) {
        // no bloquear guardado por backup
      }

      return true;
    },

    async exportCurrentVault() {
      const username = window.SGF?.session?.username;
      if (!username) throw new Error('No hay sesión activa.');
      const record = await idbGetVault(username);
      if (!record) throw new Error('No existe bóveda para este usuario.');

      return {
        username: record.username,
        schemaVersion: record.schemaVersion,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        saltB64: record.saltB64,
        ivB64: record.ivB64,
        cipherB64: record.cipherB64,
      };
    },

    async exportCurrentVaultFile() {
      const payload = await vault.exportCurrentVault();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SGF_${safeUserFilename(payload.username)}_vault.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    },

    async importVaultPayload(payload, { overwrite = true } = {}) {
      if (!payload || typeof payload !== 'object') throw new Error('Archivo inválido.');
      const required = ['username', 'schemaVersion', 'saltB64', 'ivB64', 'cipherB64'];
      for (const k of required) if (!payload[k]) throw new Error(`Respaldo inválido: falta ${k}.`);

      const username = String(payload.username).trim();
      if (!username) throw new Error('Respaldo inválido: username vacío.');

      const existing = await idbGetVault(username);
      if (existing && !overwrite) throw new Error('El usuario ya existe.');

      const now = nowIso();
      const record = {
        username,
        schemaVersion: Number(payload.schemaVersion || 1),
        createdAt: String(payload.createdAt || now),
        updatedAt: String(payload.updatedAt || now),
        saltB64: String(payload.saltB64),
        ivB64: String(payload.ivB64),
        cipherB64: String(payload.cipherB64),
      };
      await idbPutVault(record);
      return true;
    },

    async importAndOpenPayload(payload, password, { overwrite = true } = {}) {
      await vault.importVaultPayload(payload, { overwrite });
      const username = String(payload.username || '').trim();
      await vault.openUser(username, password);
      return true;
    },

    async listLocalUsers() {
      return await idbListUsers();
    },

    async deleteUser(username) {
      username = String(username || '').trim();
      if (!username) throw new Error('Usuario inválido.');
      await idbDeleteVault(username);
      await idbDeleteBackupsForUser(username);
      // Si borras el usuario activo, limpiar sesión
      if (String(window.SGF?.session?.username || '') === username) {
        delete window.SGF.session;
        delete window.SGF.sqlDb;
      }
      return true;
    },

    async deleteAllUsers() {
      await idbClearAll();
      delete window.SGF.session;
      delete window.SGF.sqlDb;
      return true;
    },

    async listBackups(username = null) {
      const u = username ? String(username) : String(window.SGF?.session?.username || '');
      if (!u) return [];
      return await idbListBackups(u);
    },

    async downloadBackupFile(backupId) {
      const b = await idbGetBackup(backupId);
      if (!b) throw new Error('Backup no encontrado.');
      const payload = {
        username: b.username,
        schemaVersion: b.schemaVersion || 1,
        createdAt: b.createdAt,
        updatedAt: b.createdAt,
        saltB64: b.saltB64,
        ivB64: b.ivB64,
        cipherB64: b.cipherB64,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safe = safeUserFilename(payload.username);
      const ts = String(b.createdAt || '').replaceAll(':', '').replaceAll('-', '').replace('T', '_').replace('Z', '');
      a.download = `SGF_${safe}_backup_${ts || 'auto'}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    },

    async downloadLatestBackupFile(username = null) {
      const rows = await vault.listBackups(username);
      if (!rows.length) throw new Error('No hay auto-backups.');
      return await vault.downloadBackupFile(rows[0].id);
    },

    async restoreBackup(backupId) {
      const b = await idbGetBackup(backupId);
      if (!b) throw new Error('Backup no encontrado.');

      const existing = await idbGetVault(b.username);
      if (!existing) {
        // si no existía, lo crea igual
        const record = {
          username: b.username,
          schemaVersion: Number(b.schemaVersion || 1),
          createdAt: b.createdAt || nowIso(),
          updatedAt: nowIso(),
          saltB64: b.saltB64,
          ivB64: b.ivB64,
          cipherB64: b.cipherB64,
        };
        await idbPutVault(record);
      } else {
        const record = {
          ...existing,
          updatedAt: nowIso(),
          saltB64: b.saltB64,
          ivB64: b.ivB64,
          cipherB64: b.cipherB64,
        };
        await idbPutVault(record);
      }

      // Si es el usuario activo, recargar DB en memoria
      const active = String(window.SGF?.session?.username || '');
      if (active && active === String(b.username) && window.SGF?.session?.password) {
        try {
          const vaultRec = await idbGetVault(active);
          const bytes = decryptBytes(vaultRec, window.SGF.session.password);
          const tmp = new vault.SQL.Database(bytes);
          try { tmp.exec('PRAGMA foreign_keys = ON;'); } catch (_) {}
          window.SGF.sqlDb = tmp;
        } catch (_) {
          // si falla descifrado, no romper
        }
      }
      return true;
    },

    async restoreLatestBackup(username = null) {
      const rows = await vault.listBackups(username);
      if (!rows.length) throw new Error('No hay auto-backups.');
      await vault.restoreBackup(rows[0].id);
      return true;
    },
  };

  // Exponer
  window.SGF.vault = vault;
  // Alias por compatibilidad
  window.SGF.gate = vault;
})();
