// v1.28.3 - Base común de Reportes (fix drilldown moneda + robustez listMovements)
window.SGF = window.SGF || {};
window.SGF.reports = window.SGF.reports || window.SGF.reports || {};
window.SGF.reports.data = window.SGF.reports.data || {};

(function(ns){
  function qAll(db, sql, params){
    const p = params || {};
    if (!db) throw new Error('DB_UNAVAILABLE');
    // SGF.db (wrapper)
    if (typeof db.select === 'function') return db.select(sql, p) || [];
    // sql.js Database
    if (typeof db.exec === 'function') return toRows(db.exec(sql, p));
    throw new Error('DB_UNSUPPORTED');
  }
  function qFirstValue(db, sql, params){
    const p = params || {};
    if (!db) throw new Error('DB_UNAVAILABLE');
    if (typeof db.scalar === 'function') return db.scalar(sql, p);
    if (typeof db.select === 'function'){
      const rows = db.select(sql, p) || [];
      if (!rows.length) return null;
      const first = rows[0];
      const k = Object.keys(first)[0];
      return first[k];
    }
    if (typeof db.exec === 'function'){
      const r = db.exec(sql, p);
      if (!r || !r.length || !r[0].values || !r[0].values.length) return null;
      return r[0].values[0][0];
    }
    throw new Error('DB_UNSUPPORTED');
  }
  function toRows(result){
    if (!result || !result.length || !result[0]) return [];
    const columns = Array.isArray(result[0].columns) ? result[0].columns : [];
    const values = Array.isArray(result[0].values) ? result[0].values : [];
    if (!columns.length || !values.length) return [];
    return values.map(v => {
      const row = {};
      for (let i=0;i<columns.length;i++) row[columns[i]] = v[i];
      return row;
    });
  }

  // Schema helper: detect if a table has a column (works for SGF.db wrapper or sql.js db)
  
  const __tableCache = {};
  function hasTable(db, table){
    if (__tableCache[table] != null) return __tableCache[table];
    try{
      const rows = qAll(db, "SELECT name FROM sqlite_master WHERE type='table' AND name=:t", {':t': table});
      const ok = Array.isArray(rows) && rows.length>0;
      __tableCache[table]=ok;
      return ok;
    }catch(_){
      __tableCache[table]=false;
      return false;
    }
  }

const __colCache = {};
  function hasColumn(db, table, col){
    const key = `${table}.${col}`;
    if (key in __colCache) return __colCache[key];
    try{
      let rows = [];
      const sql = `PRAGMA table_info(${table})`;
      if (db && typeof db.select === 'function') rows = db.select(sql, {}) || [];
      else if (db && typeof db.exec === 'function') rows = toRows(db.exec(sql, {})) || [];
      const ok = rows.some(r => String(r.name || r.column || '').toLowerCase() === String(col).toLowerCase());
      __colCache[key] = ok;
      return ok;
    }catch(_){
      __colCache[key] = false;
      return false;
    }
  }

  function pushSoftDeleteWhere(whereArr, db, table, alias, col){
    if (hasColumn(db, table, col)) whereArr.push(`COALESCE(${alias}.${col},0)=0`);
  }

  function periodBetweenSql(col){ return `${col} >= :p1 AND ${col} <= :p2`; }

  function computeRange(year, month){
    if (year === 'all' && month === 'all') return { p1: null, p2: null, endPeriod: null };
    if (year !== 'all' && month === 'all'){
      const p1 = `${year}-01`, p2 = `${year}-12`;
      return { p1, p2, endPeriod: p2 };
    }
    const mm = String(month).padStart(2,'0');
    const p = `${year}-${mm}`;
    return { p1: p, p2: p, endPeriod: p };
  }

  async function normalizeYearMonth({ db, year, month, currency, accountId }){
    if (month === 'all') return { year, month };
    if (year !== 'all') return { year, month };
    const mm = String(month).padStart(2,'0');
    let where = "substr(m.period,6,2)=:mm";
    const params = { ':mm': mm };
    if (currency && currency !== 'all'){ where += " AND m.currency=:cur"; params[':cur']=currency; }
    if (accountId && accountId !== 'all'){ where += " AND m.account_id=:aid"; params[':aid']=Number(accountId); }
    if (hasColumn(db, "movements", "is_deleted")) where += " AND COALESCE(m.is_deleted,0)=0";
    const y = qFirstValue(db, `SELECT MAX(substr(m.period,1,4)) FROM movements m WHERE ${where}`, params);
    if (y) return { year: String(y), month };
    return { year: 'all', month: 'all' };
  }

  function getPeriods(db){
    const years = toRows(qAll(db, "SELECT DISTINCT substr(period,1,4) AS y FROM movements ORDER BY y DESC")).map(r=>String(r.y));
    const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
    return { years, months };
  }

  function getAccounts(db, currency){
    let sql = `SELECT a.id, a.name, a.currency, COALESCE(t.name,'') AS type_name
               FROM accounts a
               LEFT JOIN account_types t ON t.id=a.type_id
               WHERE 1=1`;
    const params = {};
    if (currency && currency !== 'all'){ sql += " AND a.currency=:cur"; params[':cur']=currency; }
    sql += " ORDER BY type_name ASC, a.name ASC";
    return toRows(qAll(db, sql, params));
  }

  function getCategories(db){
    return toRows(qAll(db, `SELECT id, name, parent_id, COALESCE(active,1) AS active
                            FROM categories
                            ORDER BY name COLLATE NOCASE ASC`));
  }

  // (Los agregadores sumByAccount/sumByCategory se integran en fase siguiente para evitar riesgos)
  ns.normalizeYearMonth = normalizeYearMonth;
  ns.getPeriods = getPeriods;
  ns.getAccounts = getAccounts;
  ns.getCategories = getCategories;

  function dbAll(sql, params = {}) {
    return window.SGF?.db?.select?.(sql, params) || [];
  }

  // Lista movimientos para drill-down (fase 3)
  // scope:
  //  - { kind:'category', id:number } => incluye splits
  //  - { kind:'account', id:number }  => incluye income/expense/transfer que afectan a la cuenta
  // opts: { range:{whereSql, params}, currency, type:'expense'|'income'|'both' }
  function listMovements({ scope, range, currency, type }) {
    const dbx = window.SGF?.db || window.SGF?.sqlDb;
    const db = dbx;
    const hasSplit = hasColumn(db,'movements','is_split');
    const hasSplits = hasTable(db,'movement_splits');
    const where = [];
    const p = {};
    if (range?.whereSql) { where.push(range.whereSql.replaceAll('period', 'm.period')); Object.assign(p, range.params || {}); }
    if (currency && currency !== 'all') { where.push(`COALESCE(m.currency,'CRC') = :cur`); p[':cur'] = currency; }
    if (hasColumn(db,'movements','is_opening')) where.push(`COALESCE(m.is_opening,0)=0`);
    pushSoftDeleteWhere(where, db, 'movements', 'm', 'is_deleted');

    const w = where.length ? `WHERE ${where.join(' AND ')}` : 'WHERE 1=1';

    const typ = (type || 'expense');
    const both = (typ === 'both') ? 1 : 0;
    p[':both'] = both;

    if (!scope || !scope.kind) return [];

    if (scope.kind === 'category') {
      const cid = Number(scope.id || 0);
      if (!cid) return [];
      p[':cid'] = cid;

      // Type filter
      let typeSql = "";
      if (typ === 'both') typeSql = " AND m.type IN ('income','expense')";
      else typeSql = " AND m.type = :typ";
      if (typ !== 'both') p[':typ'] = typ;

      const splitCond0 = hasSplit ? " AND COALESCE(m.is_split,0)=0" : "";
      const splitCond1 = hasSplit ? " AND COALESCE(m.is_split,0)=1" : "";

      const q1 = `
        SELECT m.date, m.description,
               (SELECT a.name FROM accounts a WHERE a.id = m.account_id) AS detail,
               CASE WHEN :both=1 AND m.type='expense' THEN -m.amount ELSE m.amount END AS amount
        FROM movements m
        ${w}${typeSql}${splitCond0} AND COALESCE(m.category_id,0)=:cid
      `;

      const q2 = `
        SELECT m.date, m.description,
               (SELECT a.name FROM accounts a WHERE a.id = m.account_id) AS detail,
               CASE WHEN :both=1 AND m.type='expense' THEN -s.amount ELSE s.amount END AS amount
        FROM movements m
        JOIN movement_splits s ON s.movement_id = m.id
        ${w}${typeSql}${splitCond1} AND COALESCE(s.category_id,0)=:cid
      `;

      if (hasSplit && hasSplits) return dbAll(`${q1} UNION ALL ${q2} ORDER BY date ASC`, p) || [];
      return dbAll(`${q1} ORDER BY date ASC`, p) || [];
    }

    if (scope.kind === 'pnl') {
      // Estado de Resultados: movimientos por tipo (income/expense/both)
      const aid = Number(scope.accountId || 0);
      if (aid) { where.push(`m.account_id = :aid`); p[':aid']=aid; }
      let typeSql = '';
      if (typ === 'both') typeSql = " AND m.type IN ('income','expense')";
      else typeSql = " AND m.type = :typ";
      if (typ !== 'both') p[':typ']=typ;
      const q = `
        SELECT m.date, m.description,
               (SELECT c.name FROM categories c WHERE c.id = m.category_id) AS detail,
               CASE WHEN m.type='expense' THEN -m.amount ELSE m.amount END AS amount
        FROM movements m
        ${w}${typeSql}
        ORDER BY m.date ASC
      `;
      return dbAll(q, p) || [];
    }

    if (scope.kind === 'account') {
      const aid = Number(scope.id || 0);
      if (!aid) return [];
      p[':aid'] = aid;

      // For accounts, include transfers that affect the account.
      // Map type filter:
      //  expense => expense + transfer OUT
      //  income  => income  + transfer IN
      //  both    => income + expense + transfer (in/out)
      let cond = "";
      if (typ === 'both') {
        cond = " AND ( (m.type IN ('income','expense')) OR (m.type='transfer') )";
      } else if (typ === 'expense') {
        cond = " AND (m.type='expense' OR (m.type='transfer'))";
      } else {
        cond = " AND (m.type='income' OR (m.type='transfer'))";
      }

      const q = `
        SELECT m.date,
               m.description,
               CASE
                 WHEN m.type='transfer' AND m.account_id=:aid THEN (SELECT a.name FROM accounts a WHERE a.id = m.account_to_id)
                 WHEN m.type='transfer' AND m.account_to_id=:aid THEN (SELECT a.name FROM accounts a WHERE a.id = m.account_id)
                 ELSE (SELECT c.name FROM categories c WHERE c.id = m.category_id)
               END AS detail,
               CASE
                 WHEN m.type='expense' AND m.account_id=:aid THEN -m.amount
                 WHEN m.type='income'  AND m.account_id=:aid THEN  m.amount
                 WHEN m.type='transfer' AND m.account_id=:aid THEN -m.amount
                 WHEN m.type='transfer' AND m.account_to_id=:aid THEN COALESCE(m.amount_to,m.amount)
                 ELSE 0
               END AS amount
        FROM movements m
        ${w}${cond} AND (m.account_id=:aid OR m.account_to_id=:aid)
        ORDER BY m.date ASC
      `;
      return dbAll(q, p) || [];
    }

    return [];
  }

  ns.listMovements = listMovements;


  function dbRows(db, sql, params){
    const r = qAll(db, sql, params || {});
    // SGF.db wrapper ya devuelve array de objetos -> devolver tal cual
    if (Array.isArray(r) && (r.length === 0 || (r[0] && typeof r[0] === 'object' && !('columns' in r[0]) && !('values' in r[0])))) return r;
    return toRows(r);
  }

  // Totales por categoría (incluye splits) respetando filtros
  function queryCategoryTotals({ db, year, month, currency, accountId, type }){
    const y = year || 'all';
    const m = month || 'all';
    const cur = currency || 'all';
    const aid = Number(accountId || 0);
    const t = type || 'expense';

    const range = computeRange(y, m === 'all' ? 'all' : String(m).includes('-') ? String(m).slice(5,7) : m);
    const where = [];
    const p = {};

    // period filter
    if (range.p1 && range.p2){
      where.push(periodBetweenSql('m.period'));
      p[':p1'] = range.p1;
      p[':p2'] = range.p2;
    }

    if (cur && cur !== 'all'){ where.push("m.currency = :cur"); p[':cur']=cur; }

    // tipo filter
    // both => incluir income+expense, en both se invierte expense para mostrar neto
    p[':both'] = (t === 'both') ? 1 : 0;
    if (t !== 'both'){ where.push("m.type = :t"); p[':t']=t; }

    pushSoftDeleteWhere(where, db, "movements", "m", "is_deleted");
    where.push("COALESCE(m.is_opening,0)=0");
    if (aid){ where.push("m.account_id = :aid"); p[':aid']=aid; }

    const w = where.length ? `WHERE ${where.join(' AND ')}` : 'WHERE 1=1';

    const nonSplit = dbRows(db,
      `SELECT COALESCE(m.category_id,0) AS category_id,
              COALESCE(SUM(CASE WHEN :both=1 AND m.type='expense' THEN -m.amount ELSE m.amount END),0) AS total
       FROM movements m
       ${w} AND COALESCE(m.is_split,0)=0
       GROUP BY COALESCE(m.category_id,0)`,
      p
    );

    const split = dbRows(db,
      `SELECT COALESCE(s.category_id,0) AS category_id,
              COALESCE(SUM(CASE WHEN :both=1 AND m.type='expense' THEN -s.amount ELSE s.amount END),0) AS total
       FROM movements m
       JOIN movement_splits s ON s.movement_id = m.id
       ${w} AND COALESCE(m.is_split,0)=1
       GROUP BY COALESCE(s.category_id,0)`,
      p
    );

    const byId = new Map();
    for (const r of nonSplit) byId.set(Number(r.category_id), (byId.get(Number(r.category_id)) || 0) + Number(r.total||0));
    for (const r of split) byId.set(Number(r.category_id), (byId.get(Number(r.category_id)) || 0) + Number(r.total||0));
    return byId;
  }

  ns.queryCategoryTotals = queryCategoryTotals;

  // Estado de Resultados: suma ingresos y gastos para el rango (sin transfers)
  
  // Flujo de Caja: entradas/salidas/transferencias/ahorros para el rango
  function queryCashFlow({ db, year, month, currency, accountId }){
    const y = year || 'all';
    const mo = month || 'all';
    const cur = currency || 'all';
    const aid = Number(accountId || 0);

    const range = computeRange(y, mo);
    const where = [];
    const p = {};

    if (range.p1 && range.p2){
      where.push(periodBetweenSql('m.period'));
      p[':p1']=range.p1; p[':p2']=range.p2;
    }
    if (cur && cur !== 'all'){ where.push("COALESCE(m.currency,'CRC') = :cur"); p[':cur']=cur; }
    pushSoftDeleteWhere(where, db, "movements", "m", "is_deleted");
    if (hasColumn(db, 'movements', 'is_opening')) where.push("COALESCE(m.is_opening,0)=0");

    const w = where.length ? `WHERE ${where.join(' AND ')}` : 'WHERE 1=1';

    // Ingresos / Gastos
    const ie = dbRows(db, `
      SELECT m.type, COALESCE(SUM(m.amount),0) AS total
      FROM movements m
      ${w} AND m.type IN ('income','expense') ${aid ? " AND m.account_id=:aid" : ""}
      GROUP BY m.type
    `, aid ? { ...p, ':aid': aid } : p);

    let income=0, expense=0;
    for (const r of ie){
      if (String(r.type)==='income') income=Number(r.total||0);
      if (String(r.type)==='expense') expense=Number(r.total||0);
    }

    // Transferencias (neto) excluyendo ahorros si hay columna
    const hasSavings = hasColumn(db, 'movements', 'is_savings');
    const tr = dbRows(db, `
      SELECT
        COALESCE(SUM(CASE WHEN m.type='transfer' AND ${aid ? "m.account_to_id=:aid" : "m.account_to_id IS NOT NULL"} ${hasSavings ? " AND COALESCE(m.is_savings,0)=0" : ""} THEN COALESCE(m.amount_to,m.amount) ELSE 0 END),0) AS tin,
        COALESCE(SUM(CASE WHEN m.type='transfer' AND ${aid ? "m.account_id=:aid" : "m.account_id IS NOT NULL"} ${hasSavings ? " AND COALESCE(m.is_savings,0)=0" : ""} THEN m.amount ELSE 0 END),0) AS tout
      FROM movements m
      ${w} AND m.type='transfer'
    `, aid ? { ...p, ':aid': aid } : p);

    const transferIn = Number((tr[0]||{}).tin||0);
    const transferOut = Number((tr[0]||{}).tout||0);

    // Ahorros (si aplica)
    let savingsIn=0, savingsOut=0;
    if (hasSavings){
      const sk = hasColumn(db,'movements','savings_kind');
      const sav = dbRows(db, `
        SELECT
          COALESCE(SUM(CASE WHEN m.type='transfer' AND COALESCE(m.is_savings,0)=1 ${sk ? " AND m.savings_kind='deposit'" : ""} AND ${aid ? "m.account_to_id=:aid" : "m.account_to_id IS NOT NULL"} THEN COALESCE(m.amount_to,m.amount) ELSE 0 END),0) AS sin,
          COALESCE(SUM(CASE WHEN m.type='transfer' AND COALESCE(m.is_savings,0)=1 ${sk ? " AND m.savings_kind='withdraw'" : ""} AND ${aid ? "m.account_id=:aid" : "m.account_id IS NOT NULL"} THEN m.amount ELSE 0 END),0) AS sout
        FROM movements m
        ${w} AND m.type='transfer'
      `, aid ? { ...p, ':aid': aid } : p);
      savingsIn = Number((sav[0]||{}).sin||0);
      savingsOut = Number((sav[0]||{}).sout||0);
    }

    const net = income - expense + (transferIn - transferOut);

    return { income, expense, transferIn, transferOut, savingsIn, savingsOut, net };
  }
  ns.queryCashFlow = queryCashFlow;

function queryIncomeExpense({ db, year, month, currency, accountId }){
    const y = year || 'all';
    const mo = month || 'all';
    const cur = currency || 'all';
    const aid = Number(accountId || 0);

    const range = computeRange(y, mo === 'all' ? 'all' : String(mo).includes('-') ? String(mo).slice(5,7) : mo);
    const where = [];
    const p = {};

    if (range.p1 && range.p2){
      where.push(periodBetweenSql('m.period'));
      p[':p1']=range.p1; p[':p2']=range.p2;
    }
    if (cur && cur !== 'all'){ where.push("m.currency = :cur"); p[':cur']=cur; }
    pushSoftDeleteWhere(where, db, "movements", "m", "is_deleted");
    where.push("COALESCE(m.is_opening,0)=0");
    if (aid){ where.push("m.account_id = :aid"); p[':aid']=aid; }

    const w = where.length ? `WHERE ${where.join(' AND ')}` : 'WHERE 1=1';

    const rows = dbRows(db, `
      SELECT m.type,
             COALESCE(SUM(m.amount),0) AS total
      FROM movements m
      ${w} AND m.type IN ('income','expense')
      GROUP BY m.type
    `, p);

    let income = 0, expense = 0;
    for (const r of rows){
      if (String(r.type) === 'income') income = Number(r.total||0);
      if (String(r.type) === 'expense') expense = Number(r.total||0);
    }
    return { income, expense, net: income - expense };
  }
  ns.queryIncomeExpense = queryIncomeExpense;


  // Presupuesto vs Real: retorna Map(categoryId => { budget, actual })
  function queryBudgetVsActual({ db, year, month, currency, accountId }){
    const y = year || 'all';
    const mo = month || 'all';
    const cur = currency || 'CRC';
    const aid = Number(accountId || 0);

    const range = computeRange(y, mo);
    const p = {};
    let bw = ["b.type='expense'"];
    if (hasColumn(db,'budgets','active')) bw.push("COALESCE(b.active,1)=1");
    if (range.p1 && range.p2){
      bw.push("b.period BETWEEN :p1 AND :p2"); p[':p1']=range.p1; p[':p2']=range.p2;
    }
    if (cur && cur !== 'all'){ bw.push("COALESCE(b.currency,'CRC') = :cur"); p[':cur']=cur; }
    const bwSql = bw.length ? `WHERE ${bw.join(' AND ')}` : 'WHERE 1=1';

    const budgets = hasTable(db,'budgets') ? dbRows(db, `
      SELECT COALESCE(b.category_id,0) AS categoryId,
             COALESCE(SUM(b.amount),0) AS budget
      FROM budgets b
      ${bwSql}
      GROUP BY b.category_id
    `, p) : [];

    // Actual expenses (movements)
    let mw = ["m.type='expense'"];
    if (range.p1 && range.p2){
      mw.push("m.period BETWEEN :p1 AND :p2");
    }
    if (cur && cur !== 'all'){ mw.push("COALESCE(m.currency,'CRC') = :cur"); }
    if (aid){ mw.push("m.account_id = :aid"); p[':aid']=aid; }
    pushSoftDeleteWhere(mw, db, "movements", "m", "is_deleted");
    if (hasColumn(db,'movements','is_opening')) mw.push("COALESCE(m.is_opening,0)=0");

    const mwSql = mw.length ? `WHERE ${mw.join(' AND ')}` : 'WHERE 1=1';
    const hasSplit = hasColumn(db,'movements','is_split');
    const nonSplit = dbRows(db, `
      SELECT COALESCE(m.category_id,0) AS categoryId,
             COALESCE(SUM(m.amount),0) AS actual
      FROM movements m
      ${mwSql} ${hasSplit ? " AND COALESCE(m.is_split,0)=0" : ""}
      GROUP BY m.category_id
    `, p);

    let split = [];
    if (hasTable(db,'movement_splits') && hasColumn(db,'movement_splits','movement_id') && hasColumn(db,'movement_splits','amount')){
      split = dbRows(db, `
        SELECT COALESCE(s.category_id,0) AS categoryId,
               COALESCE(SUM(s.amount),0) AS actual
        FROM movements m
        JOIN movement_splits s ON s.movement_id = m.id
        ${mwSql} ${hasSplit ? " AND COALESCE(m.is_split,0)=1" : ""}
        GROUP BY s.category_id
      `, p);
    }

    const out = new Map();
    const put = (cid, k, v)=>{
      const id = Number(cid||0);
      if (!out.has(id)) out.set(id, { budget:0, actual:0 });
      out.get(id)[k] += Number(v||0);
    };

    for (const r of budgets) put(r.categoryId,'budget',r.budget);
    for (const r of nonSplit) put(r.categoryId,'actual',r.actual);
    for (const r of split) put(r.categoryId,'actual',r.actual);

    return out;
  }
  ns.queryBudgetVsActual = queryBudgetVsActual;


  // Tendencias (12 meses): agrupa por categoría o cuenta y retorna matriz [row][month]
  function queryTrend12m({ db, endPeriod, months, currency, accountId, type, groupBy }){
    const endP = String(endPeriod || '');
    const n = Number(months || 12) || 12;
    const cur = currency || 'all';
    const aid = Number(accountId || 0);
    const typ = type || 'expense';
    const grp = groupBy || 'category'; // 'category' | 'account'

    // build periods list (YYYY-MM) from end backwards
    const parts = endP.split('-');
    let y = Number(parts[0] || 0);
    let m = Number(parts[1] || 0);
    if (!y || !m) {
      // fallback to latest period in DB
      const last = qFirstValue(db, "SELECT MAX(period) AS p FROM movements", {}) || '';
      const pp = String(last).split('-');
      y = Number(pp[0] || 0) || (new Date()).getFullYear();
      m = Number(pp[1] || 0) || ((new Date()).getMonth()+1);
    }
    const periods = [];
    for (let i=0;i<n;i++){
      const mm = String(m).padStart(2,'0');
      periods.unshift(`${y}-${mm}`);
      m -= 1;
      if (m<=0){ m=12; y-=1; }
    }
    const p1 = periods[0];
    const p2 = periods[periods.length-1];

    const where = [];
    const p = { ':p1': p1, ':p2': p2 };
    where.push("m.period BETWEEN :p1 AND :p2");
    if (cur && cur !== 'all') { where.push("COALESCE(m.currency,'CRC') = :cur"); p[':cur']=cur; }
    pushSoftDeleteWhere(where, db, "movements", "m", "is_deleted");
    if (hasColumn(db,'movements','is_opening')) where.push("COALESCE(m.is_opening,0)=0");
    if (aid && grp === 'category') { where.push("m.account_id = :aid"); p[':aid']=aid; }
    if (typ === 'income') where.push("m.type='income'");
    else if (typ === 'expense') where.push("m.type='expense'");
    else where.push("m.type IN ('income','expense')");

    const w = where.length ? `WHERE ${where.join(' AND ')}` : 'WHERE 1=1';

    const hasSplit = hasColumn(db,'movements','is_split');
    const hasSplitsTable = hasTable(db,'movement_splits');

    if (grp === 'account'){
      // only non-split for account grouping (splits don't affect account)
      const rows = dbRows(db, `
        SELECT m.account_id AS gid, m.period AS period, COALESCE(SUM(m.amount),0) AS total
        FROM movements m
        ${w} ${hasSplit ? " AND COALESCE(m.is_split,0)=0" : ""}
        GROUP BY m.account_id, m.period
      `, p);

      const nameRows = dbRows(db, `SELECT id, name FROM accounts WHERE active=1`, {});
      const names = new Map(nameRows.map(r=>[Number(r.id), String(r.name||'Cuenta')]));

      return pivotPeriods(periods, rows, (r)=>Number(r.gid||0), (gid)=>names.get(gid)||`Cuenta #${gid}`);
    }

    // category grouping: handle splits if available
    const baseRows = dbRows(db, `
      SELECT COALESCE(m.category_id,0) AS gid, m.period AS period, COALESCE(SUM(m.amount),0) AS total
      FROM movements m
      ${w} ${hasSplit ? " AND COALESCE(m.is_split,0)=0" : ""}
      GROUP BY m.category_id, m.period
    `, p);

    let splitRows = [];
    if (hasSplit && hasSplitsTable && hasColumn(db,'movement_splits','movement_id') && hasColumn(db,'movement_splits','amount')){
      splitRows = dbRows(db, `
        SELECT COALESCE(s.category_id,0) AS gid, m.period AS period, COALESCE(SUM(s.amount),0) AS total
        FROM movements m
        JOIN movement_splits s ON s.movement_id = m.id
        ${w} AND COALESCE(m.is_split,0)=1
        GROUP BY s.category_id, m.period
      `, p);
    }

    const merged = baseRows.concat(splitRows);

    const catWhere = hasColumn(db,'categories','is_deleted') ? "WHERE COALESCE(is_deleted,0)=0" : "";
    const catRows = dbRows(db, `SELECT id, name FROM categories ${catWhere}`, {});
    const names = new Map(catRows.map(r=>[Number(r.id), String(r.name||'Categoría')]));
    names.set(0, 'Sin categoría');

    return pivotPeriods(periods, merged, (r)=>Number(r.gid||0), (gid)=>names.get(gid)||`Cat #${gid}`);
  }

  function pivotPeriods(periods, rows, gidFn, nameFn){
    const idx = new Map(periods.map((p,i)=>[p,i]));
    const map = new Map(); // gid -> [totals]
    for (const r of rows){
      const gid = gidFn(r);
      const pi = idx.get(String(r.period));
      if (pi === undefined) continue;
      if (!map.has(gid)) map.set(gid, Array(periods.length).fill(0));
      map.get(gid)[pi] += Number(r.total||0);
    }
    const out = [];
    for (const [gid, arr] of map.entries()){
      const total = arr.reduce((a,b)=>a+b,0);
      out.push({ id: gid, name: nameFn(gid), totals: arr, total });
    }
    // sort by abs total desc
    out.sort((a,b)=>Math.abs(b.total)-Math.abs(a.total));
    return { periods, rows: out };
  }

  ns.queryTrend12m = queryTrend12m;


  // Insights: Top categorías y comercios (considera splits)
  function queryTopCategories({ db, year, month, currency, accountId, type, limit }){
    const y = year || 'all';
    const mo = month || 'all';
    const cur = currency || 'all';
    const aid = Number(accountId || 0);
    const typ = type || 'expense';
    const lim = Number(limit || 15) || 15;

    const range = computeRange(y, mo);
    const where = [];
    const p = {};
    if (range.p1 && range.p2){ where.push("m.period BETWEEN :p1 AND :p2"); p[':p1']=range.p1; p[':p2']=range.p2; }
    if (cur && cur !== 'all'){ where.push("COALESCE(m.currency,'CRC')=:cur"); p[':cur']=cur; }
    if (aid){ where.push("m.account_id=:aid"); p[':aid']=aid; }
    if (typ==='income') where.push("m.type='income'");
    else if (typ==='expense') where.push("m.type='expense'");
    else where.push("m.type IN ('income','expense')");
    pushSoftDeleteWhere(where, db, "movements", "m", "is_deleted");
    if (hasColumn(db,'movements','is_opening')) where.push("COALESCE(m.is_opening,0)=0");
    const w = where.length ? `WHERE ${where.join(' AND ')}` : 'WHERE 1=1';

    const hasSplit = hasColumn(db,'movements','is_split');
    const base = dbRows(db, `
      SELECT COALESCE(m.category_id,0) AS categoryId, COALESCE(SUM(m.amount),0) AS total
      FROM movements m
      ${w} ${hasSplit ? " AND COALESCE(m.is_split,0)=0" : ""}
      GROUP BY m.category_id
    `, p);

    let split = [];
    if (hasSplit && hasTable(db,'movement_splits') && hasColumn(db,'movement_splits','movement_id')){
      split = dbRows(db, `
        SELECT COALESCE(s.category_id,0) AS categoryId, COALESCE(SUM(s.amount),0) AS total
        FROM movements m
        JOIN movement_splits s ON s.movement_id=m.id
        ${w} AND COALESCE(m.is_split,0)=1
        GROUP BY s.category_id
      `, p);
    }

    const merged = new Map();
    const add=(cid,amt)=>{
      const id=Number(cid||0);
      merged.set(id, (merged.get(id)||0)+Number(amt||0));
    };
    for (const r of base) add(r.categoryId, r.total);
    for (const r of split) add(r.categoryId, r.total);

    const catWhere = hasColumn(db,'categories','is_deleted') ? "WHERE COALESCE(is_deleted,0)=0" : "";
    const namesRows = dbRows(db, `SELECT id, name FROM categories ${catWhere}`, {});
    const names = new Map(namesRows.map(r=>[Number(r.id), String(r.name||'Categoría')]));
    names.set(0,'Sin categoría');

    const out=[];
    for (const [id,total] of merged.entries()){
      out.push({ id, name: names.get(id)||`Cat #${id}`, total: Number(total||0) });
    }
    out.sort((a,b)=>Math.abs(b.total)-Math.abs(a.total));
    return out.slice(0, lim);
  }

  function queryTopMerchants({ db, year, month, currency, accountId, type, limit }){
    const y = year || 'all';
    const mo = month || 'all';
    const cur = currency || 'all';
    const aid = Number(accountId || 0);
    const typ = type || 'expense';
    const lim = Number(limit || 15) || 15;

    const range = computeRange(y, mo);
    const where = [];
    const p = {};
    if (range.p1 && range.p2){ where.push("m.period BETWEEN :p1 AND :p2"); p[':p1']=range.p1; p[':p2']=range.p2; }
    if (cur && cur !== 'all'){ where.push("COALESCE(m.currency,'CRC')=:cur"); p[':cur']=cur; }
    if (aid){ where.push("m.account_id=:aid"); p[':aid']=aid; }
    if (typ==='income') where.push("m.type='income'");
    else if (typ==='expense') where.push("m.type='expense'");
    else where.push("m.type IN ('income','expense')");
    pushSoftDeleteWhere(where, db, "movements", "m", "is_deleted");
    if (hasColumn(db,'movements','is_opening')) where.push("COALESCE(m.is_opening,0)=0");
    const w = where.length ? `WHERE ${where.join(' AND ')}` : 'WHERE 1=1';

    const rows = dbRows(db, `
      SELECT TRIM(m.description) AS merchant, COALESCE(SUM(m.amount),0) AS total
      FROM movements m
      ${w}
      GROUP BY TRIM(m.description)
      ORDER BY ABS(total) DESC
      LIMIT ${lim}
    `, p);

    return rows.map(r=>({ name: String(r.merchant||'—'), total: Number(r.total||0) }));
  }

  ns.queryTopCategories = queryTopCategories;
  ns.queryTopMerchants = queryTopMerchants;


  // Comparativo Mes a Mes (12 meses): totales por mes para ingresos/gastos/neto
  function queryMoMSummary({ db, endPeriod, months, currency, accountId }){
    const endP = String(endPeriod || '');
    const n = Number(months || 12) || 12;
    const cur = currency || 'all';
    const aid = Number(accountId || 0);

    // build periods list
    const parts = endP.split('-');
    let y = Number(parts[0] || 0);
    let m = Number(parts[1] || 0);
    if (!y || !m) {
      const last = qFirstValue(db, "SELECT MAX(period) AS p FROM movements", {}) || '';
      const pp = String(last).split('-');
      y = Number(pp[0] || 0) || (new Date()).getFullYear();
      m = Number(pp[1] || 0) || ((new Date()).getMonth()+1);
    }
    const periods = [];
    for (let i=0;i<n;i++){
      const mm = String(m).padStart(2,'0');
      periods.unshift(`${y}-${mm}`);
      m -= 1;
      if (m<=0){ m=12; y-=1; }
    }
    const p1 = periods[0];
    const p2 = periods[periods.length-1];

    const where = [];
    const p = { ':p1': p1, ':p2': p2 };
    where.push("m.period BETWEEN :p1 AND :p2");
    if (cur && cur !== 'all'){ where.push("COALESCE(m.currency,'CRC')=:cur"); p[':cur']=cur; }
    if (aid){ where.push("m.account_id=:aid"); p[':aid']=aid; }
    pushSoftDeleteWhere(where, db, "movements", "m", "is_deleted");
    if (hasColumn(db,'movements','is_opening')) where.push("COALESCE(m.is_opening,0)=0");
    const w = where.length ? `WHERE ${where.join(' AND ')}` : 'WHERE 1=1';

    const hasSplit = hasColumn(db,'movements','is_split');

    const rows = dbRows(db, `
      SELECT m.period AS period, m.type AS type, COALESCE(SUM(m.amount),0) AS total
      FROM movements m
      ${w} AND m.type IN ('income','expense')
      ${hasSplit ? " AND COALESCE(m.is_split,0)=0" : ""}
      GROUP BY m.period, m.type
    `, p);

    // map period => {income, expense}
    const map = new Map();
    for (const pe of periods) map.set(pe, { period: pe, income:0, expense:0, net:0 });
    for (const r of rows){
      const pe = String(r.period||'');
      if (!map.has(pe)) continue;
      if (String(r.type)==='income') map.get(pe).income += Number(r.total||0);
      if (String(r.type)==='expense') map.get(pe).expense += Number(r.total||0);
    }
    for (const v of map.values()) v.net = v.income - v.expense;

    return { periods, rows: periods.map(p=>map.get(p)) };
  }
  ns.queryMoMSummary = queryMoMSummary;


  // Balance por Cuenta (por periodo): retorna lista por cuenta con saldo inicial y flujos del mes
  function queryBalanceByAccount({ db, period, currency, accountId }){
    const p = { ':p': String(period) };
    const cur = currency || 'all';
    const aid = Number(accountId || 0);

    const hasOpening = hasColumn(db,'movements','is_opening');
    const hasSavings = hasColumn(db,'movements','is_savings');
    const hasAmtTo = hasColumn(db,'movements','amount_to');

    const accFilter = aid ? " AND a.id = :aid" : "";
    if (aid) p[':aid']=aid;

    const curFilter = (cur && cur !== 'all') ? " AND a.currency = :cur" : "";
    if (cur && cur !== 'all') p[':cur']=cur;

    // Init balances: all movements before period, plus opening inside period
    const initWhere = hasOpening
      ? "(m.period < :p OR (m.period = :p AND COALESCE(m.is_opening,0)=1))"
      : "(m.period < :p)";

    // normalize deltas by account side
    const initA = dbRows(db, `
      SELECT a.id AS accountId,
             COALESCE(SUM(
               CASE
                 WHEN m.type='income'  THEN m.amount
                 WHEN m.type='expense' THEN -m.amount
                 WHEN m.type='transfer' THEN -m.amount
                 ELSE 0
               END
             ),0) AS delta
      FROM movements m
      JOIN accounts a ON a.id = m.account_id
      WHERE ${initWhere}
      ${curFilter}
      ${accFilter}
      GROUP BY a.id
    `, p);

    const initB = dbRows(db, `
      SELECT a.id AS accountId,
             COALESCE(SUM(
               CASE
                 WHEN m.type='transfer' THEN ${hasAmtTo ? "COALESCE(m.amount_to,m.amount)" : "m.amount"}
                 ELSE 0
               END
             ),0) AS delta
      FROM movements m
      JOIN accounts a ON a.id = m.account_to_id
      WHERE ${initWhere} AND m.account_to_id IS NOT NULL
      ${curFilter}
      ${accFilter}
      GROUP BY a.id
    `, p);

    // Flows for the month (exclude opening)
    const flowOpenFilter = hasOpening ? " AND COALESCE(m.is_opening,0)=0" : "";
    const flowSavingsNo = hasSavings ? " AND COALESCE(m.is_savings,0)=0" : "";
    const flowSavingsYes = hasSavings ? " AND COALESCE(m.is_savings,0)=1" : "";

    const flowA = dbRows(db, `
      SELECT a.id AS accountId,
             COALESCE(SUM(CASE WHEN m.type='income' THEN m.amount ELSE 0 END),0) AS income,
             COALESCE(SUM(CASE WHEN m.type='expense' THEN m.amount ELSE 0 END),0) AS expense,
             COALESCE(SUM(CASE WHEN m.type='transfer' ${hasSavings? "AND COALESCE(m.is_savings,0)=0" : ""} THEN m.amount ELSE 0 END),0) AS transfer_out,
             COALESCE(SUM(CASE WHEN m.type='transfer' ${hasSavings? "AND COALESCE(m.is_savings,0)=1" : ""} THEN m.amount ELSE 0 END),0) AS savings_out
      FROM movements m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.period = :p
      ${flowOpenFilter}
      ${curFilter}
      ${accFilter}
      GROUP BY a.id
    `, p);

    const flowB = dbRows(db, `
      SELECT a.id AS accountId,
             COALESCE(SUM(CASE WHEN m.type='transfer' ${hasSavings? "AND COALESCE(m.is_savings,0)=0" : ""} THEN ${hasAmtTo ? "COALESCE(m.amount_to,m.amount)" : "m.amount"} ELSE 0 END),0) AS transfer_in,
             COALESCE(SUM(CASE WHEN m.type='transfer' ${hasSavings? "AND COALESCE(m.is_savings,0)=1" : ""} THEN ${hasAmtTo ? "COALESCE(m.amount_to,m.amount)" : "m.amount"} ELSE 0 END),0) AS savings_in
      FROM movements m
      JOIN accounts a ON a.id = m.account_to_id
      WHERE m.period = :p AND m.account_to_id IS NOT NULL
      ${flowOpenFilter}
      ${curFilter}
      ${accFilter}
      GROUP BY a.id
    `, p);

    // account names
    const accRows = dbRows(db, `
      SELECT id AS accountId, name, currency
      FROM accounts
      WHERE active=1
      ${cur && cur !== 'all' ? "AND currency = :cur" : ""}
      ${aid ? "AND id = :aid" : ""}
      ORDER BY name
    `, p);

    const out = new Map();
    const ensure = (id)=>{ const k=Number(id||0); if (!out.has(k)) out.set(k, { accountId:k, name:`Cuenta #${k}`, currency:cur==='all'?'CRC':cur, init:0, income:0, expense:0, transfer_in:0, transfer_out:0, savings_in:0, savings_out:0 }); return out.get(k); };

    for (const r of accRows){
      const o = ensure(r.accountId);
      o.name = r.name || o.name;
      o.currency = r.currency || o.currency;
    }
    for (const r of initA){ ensure(r.accountId).init += Number(r.delta||0); }
    for (const r of initB){ ensure(r.accountId).init += Number(r.delta||0); }

    for (const r of flowA){
      const o = ensure(r.accountId);
      o.income += Number(r.income||0);
      o.expense += Number(r.expense||0);
      o.transfer_out += Number(r.transfer_out||0);
      o.savings_out += Number(r.savings_out||0);
    }
    for (const r of flowB){
      const o = ensure(r.accountId);
      o.transfer_in += Number(r.transfer_in||0);
      o.savings_in += Number(r.savings_in||0);
    }

    const rows = Array.from(out.values()).filter(r=>r.accountId>0);
    for (const r of rows){
      const transferNet = r.transfer_in - r.transfer_out;
      const savingsNet = r.savings_in - r.savings_out;
      r.transfer_net = transferNet;
      r.savings_net = savingsNet;
      r.end = r.init + r.income - r.expense + transferNet + savingsNet;
    }

    // sort by name
    rows.sort((a,b)=>String(a.name).localeCompare(String(b.name),'es'));
    return rows;
  }
  ns.queryBalanceByAccount = queryBalanceByAccount;

  // Saldo por Mes (12 meses) para una cuenta específica
  function querySaldoPorMes({ db, endPeriod, months, currency, accountId }){
    const aid = Number(accountId||0);
    if (!aid) return { periods: [], rows: [] };

    const n = Number(months||12)||12;
    const parts = String(endPeriod||'').split('-');
    let y = Number(parts[0]||0);
    let m = Number(parts[1]||0);
    if (!y || !m){
      const last = qFirstValue(db, "SELECT MAX(period) AS p FROM movements WHERE account_id=:aid OR account_to_id=:aid", {':aid': aid}) || '';
      const pp = String(last).split('-');
      y = Number(pp[0]||0) || (new Date()).getFullYear();
      m = Number(pp[1]||0) || ((new Date()).getMonth()+1);
    }
    const periods=[];
    for (let i=0;i<n;i++){
      const mm = String(m).padStart(2,'0');
      periods.unshift(`${y}-${mm}`);
      m -= 1; if (m<=0){ m=12; y-=1; }
    }

    const rows=[];
    for (const p of periods){
      const r = queryBalanceByAccount({ db, period: p, currency, accountId: aid })[0];
      if (r) rows.push({ period:p, ...r });
      else rows.push({ period:p, accountId: aid, name:'', currency: currency==='all'?'CRC':currency, init:0,income:0,expense:0,transfer_in:0,transfer_out:0,savings_in:0,savings_out:0,transfer_net:0,savings_net:0,end:0 });
    }
    return { periods, rows };
  }
  ns.querySaldoPorMes = querySaldoPorMes;

})(window.SGF.reports.data);
