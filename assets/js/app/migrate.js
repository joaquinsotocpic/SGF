// Migraciones/seed mínimas al iniciar sesión (v1.05)

(function () {
  window.SGF = window.SGF || {};

  function nowIso() {
    return new Date().toISOString();
  }

  function ensureBaseAccountTypes() {
    const db = window.SGF.sqlDb;
    if (!db) return;

    // Inserta tipos base si no existen
    const base = ['Banco', 'Tarjeta', 'Ahorros', 'Efectivo'];
    const stmt = db.prepare('INSERT OR IGNORE INTO account_types(name,is_base,active) VALUES (:name,1,1)');
    base.forEach(name => {
      stmt.bind({ ':name': name });
      stmt.step();
      stmt.reset();
    });
    stmt.free();
  }

  function ensureDefaultConfig() {
    const db = window.SGF.sqlDb;
    if (!db) return;

    const defaults = [
      ['theme', 'light'],
      ['baseCurrency', 'CRC'],
      ['secondaryCurrency', 'USD'],
      ['defaultUsdToCrc', '500'],
    ];
    const stmt = db.prepare('INSERT OR IGNORE INTO config(key,value) VALUES (:k,:v)');
    defaults.forEach(([k, v]) => {
      stmt.bind({ ':k': k, ':v': v });
      stmt.step();
      stmt.reset();
    });
    stmt.free();
}

  function ensureDefaultSavingsAccounts() {
    const db = window.SGF.sqlDb;
    if (!db) return;

    // Asegurar que exista el tipo "Ahorros" (base)
    const tipoAhorrosId = Number(window.SGF.db?.scalar?.(
      "SELECT id FROM account_types WHERE name='Ahorros' LIMIT 1"
    ) || 0);
    if (!tipoAhorrosId) return;

    const now = nowIso();
    const exists = (name, currency) => {
      const c = window.SGF.db.scalar(
        'SELECT COUNT(*) AS c FROM accounts WHERE name=:n AND currency=:c',
        { ':n': name, ':c': currency }
      );
      return Number(c || 0) > 0;
    };

    // Siempre crear si faltan (por dispositivo/usuario)
    if (!exists('Ahorros Colones', 'CRC')) {
      db.run(
        'INSERT INTO accounts(name,type_id,parent_id,currency,color,active,allow_negative,created_at) VALUES (:n,:t,NULL,:c,:color,1,0,:d)',
        { ':n': 'Ahorros Colones', ':t': tipoAhorrosId, ':c': 'CRC', ':color': '#10b981', ':d': now }
      );
    }
    if (!exists('Ahorros Dólares', 'USD')) {
      db.run(
        'INSERT INTO accounts(name,type_id,parent_id,currency,color,active,allow_negative,created_at) VALUES (:n,:t,NULL,:c,:color,1,0,:d)',
        { ':n': 'Ahorros Dólares', ':t': tipoAhorrosId, ':c': 'USD', ':color': '#3b82f6', ':d': now }
      );
    }

    // Guardar como predeterminadas (si existen)
    try {
      const crcId = Number(window.SGF.db?.scalar?.("SELECT id FROM accounts WHERE name='Ahorros Colones' AND currency='CRC' LIMIT 1") || 0);
      const usdId = Number(window.SGF.db?.scalar?.("SELECT id FROM accounts WHERE name='Ahorros Dólares' AND currency='USD' LIMIT 1") || 0);
      if (crcId) db.run(
        'INSERT INTO config(key,value) VALUES (\'defaultSavingsCrcAccountId\',:v) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        { ':v': String(crcId) }
      );
      if (usdId) db.run(
        'INSERT INTO config(key,value) VALUES (\'defaultSavingsUsdAccountId\',:v) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        { ':v': String(usdId) }
      );
    } catch (_) {}
  }

  function ensureColumn(table, column, ddl) {
    const db = window.SGF.sqlDb;
    if (!db) return;
    try {
      const cols = window.SGF.db.select(`PRAGMA table_info(${table})`).map(r => r.name);
      if (!cols.includes(column)) {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      }
    } catch (e) {
      // No bloquear por migraciones menores
      console.warn('No se pudo asegurar columna', table, column, e);
    }
  }

  function ensureV106Columns() {
    // Cuentas: saldo inicial persistente
    ensureColumn('accounts', 'initial_balance', 'initial_balance REAL NOT NULL DEFAULT 0');
    // Movimientos: marca de saldo inicial
    ensureColumn('movements', 'is_opening', 'is_opening INTEGER NOT NULL DEFAULT 0');
    // Movimientos: soporte de generación por recurrentes (v1.07.0)
    ensureColumn('movements', 'recurring_id', 'recurring_id INTEGER');
    ensureColumn('movements', 'generated_period', 'generated_period TEXT');

    // Movimientos: adjuntos y split (compatibilidad)
    // Varias pantallas insertan/actualizan estas columnas.
    ensureColumn('movements', 'reference_url', 'reference_url TEXT');
    ensureColumn('movements', 'attachments_text', 'attachments_text TEXT');
    ensureColumn('movements', 'is_split', 'is_split INTEGER NOT NULL DEFAULT 0');
    // Plantillas recurrentes: asegurarse de que exista la tabla (v1.06.6+)
    try {
      if (window.SGF && window.SGF.sqlDb) {
        window.SGF.sqlDb.run(`CREATE TABLE IF NOT EXISTS recurring_movements (
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
        );`);

        // Índices útiles (no fallar si ya existen)
        try { window.SGF.sqlDb.run('CREATE INDEX IF NOT EXISTS idx_movements_period ON movements(period)'); } catch (_) {}
        try { window.SGF.sqlDb.run('CREATE INDEX IF NOT EXISTS idx_movements_rec_period ON movements(recurring_id, generated_period)'); } catch (_) {}
        try { window.SGF.sqlDb.run('CREATE INDEX IF NOT EXISTS idx_recurring_active ON recurring_movements(active)'); } catch (_) {}
      }
    } catch (_) {
      // ignorar si falla
    }
  }

  function ensureV108SavingsColumns() {
    // Movimientos: soporte Ahorros/Metas (v1.08)
    ensureColumn('movements', 'is_savings', 'is_savings INTEGER NOT NULL DEFAULT 0');
    ensureColumn('movements', 'savings_kind', "savings_kind TEXT");
    ensureColumn('movements', 'goal_id', 'goal_id INTEGER');
    ensureColumn('movements', 'savings_ref_id', 'savings_ref_id INTEGER');

    // Tabla de metas (si no existe)
    try {
      window.SGF.sqlDb?.run?.(`CREATE TABLE IF NOT EXISTS savings_goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CRC',
        target REAL NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );`);
    } catch (_) {}

    // Índices útiles
    try { window.SGF.sqlDb?.run?.('CREATE INDEX IF NOT EXISTS idx_movements_savings_period ON movements(is_savings, period)'); } catch (_) {}
    try { window.SGF.sqlDb?.run?.('CREATE INDEX IF NOT EXISTS idx_movements_goal ON movements(goal_id)'); } catch (_) {}
    try { window.SGF.sqlDb?.run?.('CREATE INDEX IF NOT EXISTS idx_movements_savings_ref ON movements(savings_ref_id)'); } catch (_) {}
  }

  function ensureV109Budgets() {
    try {
      window.SGF.sqlDb?.run?.(`CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period TEXT NOT NULL,
        type TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CRC',
        amount REAL NOT NULL,
        is_recurring INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        UNIQUE(period, type, category_id, currency, is_recurring),
        FOREIGN KEY(category_id) REFERENCES categories(id)
      );`);
      // Si la tabla ya existía desde versiones anteriores, asegurar columnas clave.
      ensureColumn('budgets', 'updated_at', 'updated_at TEXT');
      ensureColumn('budgets', 'currency', 'currency TEXT NOT NULL DEFAULT \'CRC\'');
      ensureColumn('budgets', 'is_recurring', 'is_recurring INTEGER NOT NULL DEFAULT 0');
      ensureColumn('budgets', 'active', 'active INTEGER NOT NULL DEFAULT 1');
      try { window.SGF.sqlDb?.run?.('CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(period)'); } catch (_) {}
      try { window.SGF.sqlDb?.run?.('CREATE INDEX IF NOT EXISTS idx_budgets_cat ON budgets(category_id)'); } catch (_) {}
    } catch (_) {}
  }
  function ensureClosureTriggers() {
    const db = window.SGF.sqlDb;
    if (!db) return;
    // Bloqueo por conciliación cerrada (integridad en DB)
    // Movements: INSERT
    try { db.run(`
      CREATE TRIGGER IF NOT EXISTS trg_movements_block_insert_closed
      BEFORE INSERT ON movements
      BEGIN
        SELECT
          CASE
            WHEN EXISTS(
              SELECT 1 FROM reconciliations r
               WHERE r.closed=1 AND r.account_id = NEW.account_id AND r.period = NEW.period
            )
            OR (NEW.type='transfer' AND NEW.account_to_id IS NOT NULL AND EXISTS(
              SELECT 1 FROM reconciliations r2
               WHERE r2.closed=1 AND r2.account_id = NEW.account_to_id AND r2.period = NEW.period
            ))
            THEN RAISE(ABORT, 'MONTH_CLOSED')
          END;
      END;
    `); } catch (_) {}

    // Movements: UPDATE
    try { db.run(`
      CREATE TRIGGER IF NOT EXISTS trg_movements_block_update_closed
      BEFORE UPDATE ON movements
      BEGIN
        -- validar estado anterior y nuevo (cambios de cuenta/periodo)
        SELECT
          CASE
            WHEN EXISTS(
              SELECT 1 FROM reconciliations r
               WHERE r.closed=1 AND r.account_id = OLD.account_id AND r.period = OLD.period
            )
            OR (OLD.type='transfer' AND OLD.account_to_id IS NOT NULL AND EXISTS(
              SELECT 1 FROM reconciliations r2
               WHERE r2.closed=1 AND r2.account_id = OLD.account_to_id AND r2.period = OLD.period
            ))
            OR EXISTS(
              SELECT 1 FROM reconciliations r3
               WHERE r3.closed=1 AND r3.account_id = NEW.account_id AND r3.period = NEW.period
            )
            OR (NEW.type='transfer' AND NEW.account_to_id IS NOT NULL AND EXISTS(
              SELECT 1 FROM reconciliations r4
               WHERE r4.closed=1 AND r4.account_id = NEW.account_to_id AND r4.period = NEW.period
            ))
            THEN RAISE(ABORT, 'MONTH_CLOSED')
          END;
      END;
    `); } catch (_) {}

    // Movements: DELETE
    try { db.run(`
      CREATE TRIGGER IF NOT EXISTS trg_movements_block_delete_closed
      BEFORE DELETE ON movements
      BEGIN
        SELECT
          CASE
            WHEN EXISTS(
              SELECT 1 FROM reconciliations r
               WHERE r.closed=1 AND r.account_id = OLD.account_id AND r.period = OLD.period
            )
            OR (OLD.type='transfer' AND OLD.account_to_id IS NOT NULL AND EXISTS(
              SELECT 1 FROM reconciliations r2
               WHERE r2.closed=1 AND r2.account_id = OLD.account_to_id AND r2.period = OLD.period
            ))
            THEN RAISE(ABORT, 'MONTH_CLOSED')
          END;
      END;
    `); } catch (_) {}

    // Splits: INSERT/UPDATE/DELETE (depende del movimiento padre)
    try { db.run(`
      CREATE TRIGGER IF NOT EXISTS trg_splits_block_insert_closed
      BEFORE INSERT ON movement_splits
      BEGIN
        SELECT CASE
          WHEN EXISTS(
            SELECT 1
              FROM movements m
              JOIN reconciliations r ON r.account_id = m.account_id AND r.period = m.period AND r.closed=1
             WHERE m.id = NEW.movement_id
          )
          OR EXISTS(
            SELECT 1
              FROM movements m
              JOIN reconciliations r ON r.account_id = m.account_to_id AND r.period = m.period AND r.closed=1
             WHERE m.id = NEW.movement_id AND m.type='transfer' AND m.account_to_id IS NOT NULL
          )
          THEN RAISE(ABORT, 'MONTH_CLOSED')
        END;
      END;
    `); } catch (_) {}

    try { db.run(`
      CREATE TRIGGER IF NOT EXISTS trg_splits_block_update_closed
      BEFORE UPDATE ON movement_splits
      BEGIN
        SELECT CASE
          WHEN EXISTS(
            SELECT 1
              FROM movements m
              JOIN reconciliations r ON r.account_id = m.account_id AND r.period = m.period AND r.closed=1
             WHERE m.id = NEW.movement_id
          )
          OR EXISTS(
            SELECT 1
              FROM movements m
              JOIN reconciliations r ON r.account_id = m.account_to_id AND r.period = m.period AND r.closed=1
             WHERE m.id = NEW.movement_id AND m.type='transfer' AND m.account_to_id IS NOT NULL
          )
          THEN RAISE(ABORT, 'MONTH_CLOSED')
        END;
      END;
    `); } catch (_) {}

    try { db.run(`
      CREATE TRIGGER IF NOT EXISTS trg_splits_block_delete_closed
      BEFORE DELETE ON movement_splits
      BEGIN
        SELECT CASE
          WHEN EXISTS(
            SELECT 1
              FROM movements m
              JOIN reconciliations r ON r.account_id = m.account_id AND r.period = m.period AND r.closed=1
             WHERE m.id = OLD.movement_id
          )
          OR EXISTS(
            SELECT 1
              FROM movements m
              JOIN reconciliations r ON r.account_id = m.account_to_id AND r.period = m.period AND r.closed=1
             WHERE m.id = OLD.movement_id AND m.type='transfer' AND m.account_to_id IS NOT NULL
          )
          THEN RAISE(ABORT, 'MONTH_CLOSED')
        END;
      END;
    `); } catch (_) {}
  }


  
  


function ensureReconciliationClosedTriggers() {
  const db = window.SGF.sqlDb;
  if (!db) return;

  // Reconciliation items: bloquear cambios si la conciliación está cerrada
  try { db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_recon_items_block_insert_closed
    BEFORE INSERT ON reconciliation_items
    BEGIN
      SELECT CASE
        WHEN EXISTS(SELECT 1 FROM reconciliations r WHERE r.id=NEW.reconciliation_id AND r.closed=1)
        THEN RAISE(ABORT,'RECON_CLOSED')
      END;
    END;
  `); } catch (_) {}

  try { db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_recon_items_block_update_closed
    BEFORE UPDATE ON reconciliation_items
    BEGIN
      SELECT CASE
        WHEN EXISTS(SELECT 1 FROM reconciliations r WHERE r.id=NEW.reconciliation_id AND r.closed=1)
        THEN RAISE(ABORT,'RECON_CLOSED')
      END;
    END;
  `); } catch (_) {}

  try { db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_recon_items_block_delete_closed
    BEFORE DELETE ON reconciliation_items
    BEGIN
      SELECT CASE
        WHEN EXISTS(SELECT 1 FROM reconciliations r WHERE r.id=OLD.reconciliation_id AND r.closed=1)
        THEN RAISE(ABORT,'RECON_CLOSED')
      END;
    END;
  `); } catch (_) {}

  // Reconciliations: si ya está cerrada, bloquear cambios (salvo reabrir)
  try { db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_reconciliations_block_update_closed
    BEFORE UPDATE ON reconciliations
    WHEN OLD.closed=1 AND NEW.closed=1
    BEGIN
      SELECT RAISE(ABORT,'RECON_CLOSED');
    END;
  `); } catch (_) {}
}
  function ensureV114RecurringIndex() {
    const db = window.SGF.sqlDb;
    if (!db) return;
    try {
      db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_movements_recurring_period ON movements(recurring_id, generated_period)');
    } catch (_) {}
  }

  function ensureV116FxColumns() {
    // Movimientos: moneda + tipo de cambio + monto destino (transfer multi-moneda) + monto en moneda base
    ensureColumn('movements', 'currency', "currency TEXT NOT NULL DEFAULT 'CRC'");
    ensureColumn('movements', 'fx_rate', 'fx_rate REAL NOT NULL DEFAULT 1');
    ensureColumn('movements', 'amount_to', 'amount_to REAL');
    ensureColumn('movements', 'base_amount', 'base_amount REAL NOT NULL DEFAULT 0');
  }

  function round2(n) {
    const x = Number(n || 0);
    return Math.round((x + Number.EPSILON) * 100) / 100;
  }

  function recomputeV116FxDerivedIfNeeded() {
    // Recalcula currency/fx_rate/amount_to/base_amount si faltan o están en 0 (migración v1.16)
    const db = window.SGF.sqlDb;
    if (!db || !window.SGF.db) return;

    const cols = window.SGF.db.select('PRAGMA table_info(movements)').map(r => r.name);
    if (!cols.includes('base_amount') || !cols.includes('currency') || !cols.includes('fx_rate') || !cols.includes('amount_to')) return;

    const baseCur = String(window.SGF.db.scalar("SELECT value FROM config WHERE key='baseCurrency' LIMIT 1") || 'CRC');
    const now = nowIso();

    const rows = window.SGF.db.select(`
      SELECT m.id, m.type, m.date, m.account_id, m.account_to_id,
             m.amount,
             COALESCE(m.currency,'') AS currency,
             COALESCE(m.fx_rate,0) AS fx_rate,
             m.amount_to,
             COALESCE(m.base_amount,0) AS base_amount
      FROM movements m
      WHERE m.amount IS NOT NULL
    `);

    if (!rows.length) return;

    const upd = db.prepare(`
      UPDATE movements
         SET currency=:cur,
             fx_rate=:fx,
             amount_to=:amt_to,
             base_amount=:base,
             updated_at=:u
       WHERE id=:id
    `);

    rows.forEach(r => {
      const id = Number(r.id);
      const amt = Number(r.amount || 0);
      const dateIso = String(r.date || '').slice(0, 10);

      const accCur = String(window.SGF.db.scalar('SELECT currency FROM accounts WHERE id=:id', { ':id': Number(r.account_id) }) || 'CRC');
      const toCur = r.account_to_id ? String(window.SGF.db.scalar('SELECT currency FROM accounts WHERE id=:id', { ':id': Number(r.account_to_id) }) || 'CRC') : null;

      let cur = String(r.currency || '').trim() || accCur;
      let fx = Number(r.fx_rate || 0);
      let amtTo = (r.amount_to == null ? null : Number(r.amount_to));
      let baseAmt = Number(r.base_amount || 0);

      const needs = (!cur) || (Math.abs(baseAmt) < 0.000001 && Math.abs(amt) > 0.000001);

      if (!needs) return;

      if (String(r.type) === 'transfer' && toCur) {
        if (toCur !== cur) {
          const suggested = Number(window.SGF.fx?.rate?.(dateIso, cur, toCur) || 0);
          if (!Number.isFinite(fx) || fx <= 0) fx = suggested > 0 ? suggested : 0;
          amtTo = (fx > 0) ? round2(amt * fx) : null;
        } else {
          fx = 1;
          amtTo = round2(amt);
        }
      } else {
        fx = 1;
        amtTo = null;
      }

      const toBase = (cur === baseCur) ? 1 : Number(window.SGF.fx?.rate?.(dateIso, cur, baseCur) || 0);
      baseAmt = (toBase > 0) ? round2(amt * toBase) : (cur === baseCur ? round2(amt) : 0);

      upd.bind({ ':cur': cur || accCur, ':fx': Number(fx || 1), ':amt_to': amtTo, ':base': baseAmt, ':u': now, ':id': id });
      try { upd.step(); } catch (e) {
        const msg = String(e && (e.message || e)).toUpperCase();
        if (!msg.includes('MONTH_CLOSED')) throw e;
      }
      upd.reset();
    });

    upd.free();
  }

  function ensureV117CatalogDeleteGuards() {
    const db = window.SGF.sqlDb;
    if (!db) return;
    // Bloquear eliminaciones si el registro está en uso (integridad operativa)
    const stmts = [
      // Tipos de cuenta: no permitir borrar base o en uso
      `CREATE TRIGGER IF NOT EXISTS trg_account_types_no_delete_base
       BEFORE DELETE ON account_types
       FOR EACH ROW
       WHEN COALESCE(OLD.is_base,0)=1
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_account_types_no_delete_in_use
       BEFORE DELETE ON account_types
       FOR EACH ROW
       WHEN EXISTS(SELECT 1 FROM accounts a WHERE a.type_id=OLD.id)
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,

      // Cuentas: no permitir borrar si tiene hijos o referencias
      `CREATE TRIGGER IF NOT EXISTS trg_accounts_no_delete_children
       BEFORE DELETE ON accounts
       FOR EACH ROW
       WHEN EXISTS(SELECT 1 FROM accounts a WHERE a.parent_id=OLD.id)
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_accounts_no_delete_in_use_mov
       BEFORE DELETE ON accounts
       FOR EACH ROW
       WHEN EXISTS(SELECT 1 FROM movements m WHERE m.account_id=OLD.id OR m.account_to_id=OLD.id)
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_accounts_no_delete_in_use_rec
       BEFORE DELETE ON accounts
       FOR EACH ROW
       WHEN EXISTS(SELECT 1 FROM recurring_movements r WHERE r.account_id=OLD.id OR r.account_to_id=OLD.id)
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_accounts_no_delete_in_use_recon
       BEFORE DELETE ON accounts
       FOR EACH ROW
       WHEN EXISTS(SELECT 1 FROM reconciliations c WHERE c.account_id=OLD.id)
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,

      // Categorías: no permitir borrar si tiene hijos o referencias
      `CREATE TRIGGER IF NOT EXISTS trg_categories_no_delete_children
       BEFORE DELETE ON categories
       FOR EACH ROW
       WHEN EXISTS(SELECT 1 FROM categories c WHERE c.parent_id=OLD.id)
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_categories_no_delete_in_use_mov
       BEFORE DELETE ON categories
       FOR EACH ROW
       WHEN EXISTS(SELECT 1 FROM movements m WHERE m.category_id=OLD.id)
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_categories_no_delete_in_use_split
       BEFORE DELETE ON categories
       FOR EACH ROW
       WHEN EXISTS(SELECT 1 FROM movement_splits s WHERE s.category_id=OLD.id)
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_categories_no_delete_in_use_budget
       BEFORE DELETE ON categories
       FOR EACH ROW
       WHEN EXISTS(SELECT 1 FROM budgets b WHERE b.category_id=OLD.id)
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,
      `CREATE TRIGGER IF NOT EXISTS trg_categories_no_delete_in_use_rec
       BEFORE DELETE ON categories
       FOR EACH ROW
       WHEN EXISTS(SELECT 1 FROM recurring_movements r WHERE r.category_id=OLD.id)
       BEGIN
         SELECT RAISE(ABORT,'IN_USE');
       END;`,
    ];
    stmts.forEach(sql => {
      try { db.run(sql); } catch (e) { /* ignore */ }
    });
  }

  async function ensureAll() {
    // Orden importa: primero columnas/tablas, luego triggers/índices, luego seeds.
    try { ensureV106Columns(); } catch (e) { console.warn('ensureV106Columns', e); }
    try { ensureV108SavingsColumns(); } catch (e) { console.warn('ensureV108SavingsColumns', e); }
    try { ensureV109Budgets(); } catch (e) { console.warn('ensureV109Budgets', e); }
    try { ensureV114RecurringIndex(); } catch (e) { console.warn('ensureV114RecurringIndex', e); }
    try { ensureV116FxColumns(); } catch (e) { console.warn('ensureV116FxColumns', e); }
    try { ensureV117CatalogDeleteGuards(); } catch (e) { console.warn('ensureV117CatalogDeleteGuards', e); }

    try { ensureBaseAccountTypes(); } catch (e) { console.warn('ensureBaseAccountTypes', e); }
    try { ensureDefaultConfig(); } catch (e) { console.warn('ensureDefaultConfig', e); }
    try { ensureDefaultSavingsAccounts(); } catch (e) { console.warn('ensureDefaultSavingsAccounts', e); }

    try { ensureClosureTriggers(); } catch (e) { console.warn('ensureClosureTriggers', e); }
    try { ensureReconciliationClosedTriggers(); } catch (e) { console.warn('ensureReconciliationClosedTriggers', e); }

    // v1.16: derivar base_amount/currency para datos existentes
    try { recomputeV116FxDerivedIfNeeded(); } catch (e) {
      const msg = String(e && (e.message || e)).toUpperCase();
      if (msg.includes('MONTH_CLOSED')) {
        // ignorar: no recalcular en meses cerrados
      } else {
        console.warn('FX recompute', e);
      }
    }

    // Persistir si hubo cambios
    try { await window.SGF.db?.save?.(); } catch (_) {}
  }

  window.SGF.migrate = { ensureAll };
})();