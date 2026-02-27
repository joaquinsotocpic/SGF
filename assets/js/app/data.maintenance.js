// Mantenimiento de datos (v1.27.0)
// - Reset completo (recrear bóveda del usuario actual)
// - Cargar base (tipos + cuentas base + ahorros predeterminados)
// - Cargar demo (base + categorías + presupuestos + conciliaciones + movimientos + ahorros)
// - Diagnosticar y reparar (periodos, huérfanos, índices/migraciones)

(function () {
  window.SGF = window.SGF || {};

  function nowIso() { return new Date().toISOString(); }
  function toPeriod(isoDate) {
    const d = String(isoDate || '');
    return d && d.length >= 7 ? d.slice(0, 7) : '';
  }

  function round2(x) { const n = Number(x || 0); return Math.round((n + Number.EPSILON) * 100) / 100; }

  function scalar(sql, params) { return window.SGF.db?.scalar?.(sql, params); }
  function select(sql, params) { return window.SGF.db?.select?.(sql, params) || []; }
  function run(sql, params) { return window.SGF.db?.run?.(sql, params) || 0; }

  async function ensureBaseTypes() {
  // Ejecuta migraciones para asegurar columnas/tablas nuevas
  try {
    await await window.SGF.migrate?.ensureAll?.();
  } catch (e) {
    console.warn('migrate.ensureAll', e);
  }

  // Asegurar tipos base (idempotente)
  try {
    const base = ['Banco', 'Tarjeta', 'Ahorros', 'Efectivo'];
    base.forEach(n => run('INSERT OR IGNORE INTO account_types(name,is_base,active) VALUES (:n,1,1)', { ':n': n }));
  } catch (_) {}
}

  // v1.23.0 demo generator helpers
  const DEMO_SEED = 2300;
  function makeRng(seed){
    let s = seed >>> 0;
    return function(){
      // xorshift32
      s ^= (s << 13) >>> 0;
      s ^= (s >> 17) >>> 0;
      s ^= (s << 5) >>> 0;
      return (s >>> 0) / 4294967296;
    };
  }

  function ymFromDate(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    return `${y}-${m}`;
  }

  function addMonths(ym, delta){
    const [y,m]=String(ym).split('-').map(Number);
    const dt = new Date(y, m-1+delta, 1);
    return ymFromDate(dt);
  }

  function ymToDate(ym, day){
    const [y,m]=String(ym).split('-');
    const dd = String(day).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }

  function hasCol(table, col){
    try{
      const rows = window.SGF.db.select(`PRAGMA table_info(${table})`);
      return (rows||[]).some(r => String(r.name||'').toLowerCase() === String(col).toLowerCase());
    }catch(_){ return false; }
  }

  const DEMO_MERCHANTS = [
    'Walmart','AutoMercado','MasxMenos','Pricesmart','Uber','Didi','PedidosYa','Amazon','Netflix','Spotify',
    'Farmacia Fischel','La Bomba','Shell','Puma','KFC','McDonalds','Burger King','Subway','Cinepolis','Kolbi',
    'ICE','AyA','CNFL','BAC','BCR','INS','CoopeAnde','Taco Bell','Papa Johns','Spoon'
  ];
  const DEMO_DESC = ['Compra','Pago','Suscripción','Recibo','Servicio','Pedido','Orden','Factura'];
  function pick(arr, rng){ return arr[Math.floor(rng()*arr.length)]; }


  function ensureConfigKey(key, value) {
    run('INSERT OR IGNORE INTO config(key,value) VALUES (:k,:v)', { ':k': key, ':v': String(value ?? '') });
  }

  function setConfigKey(key, value) {
    run('INSERT INTO config(key,value) VALUES (:k,:v) ON CONFLICT(key) DO UPDATE SET value=excluded.value', {
      ':k': key,
      ':v': String(value ?? ''),
    });
  }

  function getAccountTypeId(name) {
    const raw = String(name || '').trim();
    if (!raw) return 0;
    // Aliases comunes (evita errores por abreviaturas o datos viejos)
    const alias = {
      'Ban': 'Banco',
      'Bco': 'Banco',
      'Tar': 'Tarjeta',
      'Aho': 'Ahorros',
      'Efe': 'Efectivo',
    };
    const n = alias[raw] || raw;
    let id = Number(scalar('SELECT id FROM account_types WHERE name=:n LIMIT 1', { ':n': n }) || 0);
    if (id) return id;

    // fallback: match por prefijo (p.ej. "Banco ..." o "Tarjeta ...")
    const like = n.length >= 3 ? (n.slice(0,3) + '%') : (n + '%');
    id = Number(scalar('SELECT id FROM account_types WHERE name LIKE :p LIMIT 1', { ':p': like }) || 0);
    return id;
  }

  function findAccountIdByName(name, parentId = null) {
    if (parentId == null) {
      return Number(scalar('SELECT id FROM accounts WHERE name=:n AND parent_id IS NULL LIMIT 1', { ':n': name }) || 0);
    }
    return Number(scalar('SELECT id FROM accounts WHERE name=:n AND parent_id=:p LIMIT 1', { ':n': name, ':p': parentId }) || 0);
  }

  function upsertAccount({ name, typeName, currency, parentName = null, parentId = null, color = '#64748b', allowNegative = 0 }) {
    const typeId = getAccountTypeId(typeName);
    if (!typeId) throw new Error(`No existe tipo de cuenta: ${typeName}`);

    let pid = parentId;
    if (!pid && parentName) pid = findAccountIdByName(parentName, null) || null;

    const existingId = findAccountIdByName(name, pid);
    if (existingId) return existingId;

    const t = nowIso();
    run(
      'INSERT INTO accounts(name,type_id,parent_id,currency,color,active,allow_negative,created_at) VALUES (:n,:t,:p,:c,:color,1,:an,:d)',
      { ':n': name, ':t': typeId, ':p': pid, ':c': currency, ':color': color, ':an': allowNegative ? 1 : 0, ':d': t }
    );
    return findAccountIdByName(name, pid);
  }

  function ensureSavingsDefaults() {
    // Busca las cuentas creadas por migrate (o las crea si faltan)
    ensureBaseTypes();
    const crcId = Number(scalar("SELECT id FROM accounts WHERE name='Ahorros Colones' AND currency='CRC' LIMIT 1") || 0);
    const usdId = Number(scalar("SELECT id FROM accounts WHERE name='Ahorros Dólares' AND currency='USD' LIMIT 1") || 0);
    if (crcId) setConfigKey('defaultSavingsCrcAccountId', crcId);
    if (usdId) setConfigKey('defaultSavingsUsdAccountId', usdId);
  }

  function loadBaseAccounts() {
    ensureBaseTypes();

    // Padres (carpetas)
    const bancosId = upsertAccount({ name: 'Bancos', typeName: 'Banco', currency: 'CRC', color: '#0ea5e9' });
    const billeterasId = upsertAccount({ name: 'Billeteras', typeName: 'Efectivo', currency: 'CRC', color: '#22c55e' });
    const tarjetasId = upsertAccount({ name: 'Tarjetas', typeName: 'Tarjeta', currency: 'CRC', color: '#a855f7', allowNegative: 1 });

    // Bancos
    const bancos = [
      ['BAC Colones', 'CRC'],
      ['BAC Dólares', 'USD'],
      ['BCR Colones', 'CRC'],
      ['BCR Dólares', 'USD'],
      ['BCR Virtual Colones', 'CRC'],
      ['BN Colones', 'CRC'],
      ['BN Dólares', 'USD'],
      ['Promerica Colones', 'CRC'],
      ['Promerica Dólares', 'USD'],
    ];
    bancos.forEach(([n, c]) => upsertAccount({ name: n, typeName: 'Banco', currency: c, parentId: bancosId, color: '#0ea5e9' }));

    // Billeteras
    const wallets = [
      'Billetera FSH',
      'Billetera Ian',
      'Billetera Josué',
      'Billetera ghernandez',
      'Billetera jksotorojas',
    ];
    wallets.forEach((n) => upsertAccount({ name: n, typeName: 'Efectivo', currency: 'CRC', parentId: billeterasId, color: '#22c55e' }));
    // Caja Chica bajo billetera jksotorojas
    const bj = findAccountIdByName('Billetera jksotorojas', billeterasId);
    // Mantener color consistente padre/hijo
    if (bj) upsertAccount({ name: 'Caja Chica', typeName: 'Efectivo', currency: 'CRC', parentId: bj, color: '#22c55e' });

    // Tarjetas
    const tarjetas = [
      ['BAC Amex Colones', 'CRC'],
      ['BAC Amex Dólares', 'USD'],
      ['BAC PriceSmart Colones', 'CRC'],
      ['BAC PriceSmart Dólares', 'USD'],
      ['BAC Walmart Colones', 'CRC'],
      ['BAC Walmart Dólares', 'USD'],
      ['BP AutoPremia Colones', 'CRC'],
      ['BP AutoPremia Dólares', 'USD'],
      ['Credisiman Colones', 'CRC'],
      ['Credisiman Dólares', 'USD'],
    ];
    tarjetas.forEach(([n, c]) => upsertAccount({ name: n, typeName: 'Tarjeta', currency: c, parentId: tarjetasId, color: '#a855f7', allowNegative: 1 }));

    // Ahorros predeterminados (migrate los crea, aquí solo aseguramos config)
    ensureSavingsDefaults();
  }

  function findCategoryIdByName(name, parentId = null) {
    if (parentId == null) {
      return Number(scalar('SELECT id FROM categories WHERE name=:n AND parent_id IS NULL LIMIT 1', { ':n': name }) || 0);
    }
    return Number(scalar('SELECT id FROM categories WHERE name=:n AND parent_id=:p LIMIT 1', { ':n': name, ':p': parentId }) || 0);
  }

  function upsertCategory(name, parentId = null, color = null) {
    const id = findCategoryIdByName(name, parentId);
    // Si existe y viene un color (por herencia), mantenerlo consistente cuando está vacío.
    if (id) {
      if (color) {
        const cur = scalar('SELECT color FROM categories WHERE id=:id LIMIT 1', { ':id': id });
        if (!cur) run('UPDATE categories SET color=:c WHERE id=:id', { ':c': color, ':id': id });
      }
      return id;
    }
    run('INSERT INTO categories(name,parent_id,color,active,created_at) VALUES (:n,:p,:c,1,:d)', {
      ':n': name,
      ':p': parentId,
      ':c': color,
      ':d': nowIso(),
    });
    return findCategoryIdByName(name, parentId);
  }

  
  

  // ---- Colores de categorías (herencia por niveles) ----
  const ROOT_PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#64748b','#0ea5e9','#10b981','#a855f7'];

  function clamp01(x){ return Math.max(0, Math.min(1, x)); }
  function hexToRgb(hex){
    const h = String(hex||'').replace('#','').trim();
    if (h.length !== 6) return null;
    const n = parseInt(h,16);
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
  }
  function rgbToHex(r,g,b){
    const to = (v)=> ('0'+Math.max(0,Math.min(255,Math.round(v))).toString(16)).slice(-2);
    return `#${to(r)}${to(g)}${to(b)}`;
  }
  // Genera un color "similar" (más claro) a partir del del padre, para herencia visual por niveles.
  function deriveChildColor(parentHex, depthStep=1){
    const rgb = hexToRgb(parentHex);
    if (!rgb) return parentHex;
    const mix = clamp01(0.12 * depthStep); // 12% por nivel hacia blanco
    const r = rgb.r + (255 - rgb.r) * mix;
    const g = rgb.g + (255 - rgb.g) * mix;
    const b = rgb.b + (255 - rgb.b) * mix;
    return rgbToHex(r,g,b);
  }

function loadBaseCategories() {
    // Categorías predeterminadas (idempotente) según PDF del usuario.
        const root = {
      'Bancarios': {
        'Fondos de Inversión': {
          'Fondo 01 - Alquiler': null,
          'Fondo 02 - Colones': null,
          'Fondo 03 - Dólares': null,
        }
      },
      'Departamentales': {
        'Hogar': null,
        'Regalos': null,
        'Tecnología': null,
        'JK Pro': null,
      },
      'Educación': {
        'Academia Rhema': null,
        'Actividades': null,
        'Colegio El Rosario': { 'Matrícula': null, 'Mensualidad': null, 'Útiles': null, 'Guardería': null },
      },
      'Entretenimiento': {
        'Deportes': { 'Mejenga': null },
        'Suscripciones': { 'ChatGPT': null, 'Disney Plus': null, 'IPTV': null, 'NBA': null, 'Netflix': null },
        'Vacaciones': { 'Paseos': null, 'Viajes': null },
      },
      'Ingresos': {
        'Aguinaldo': null,
        'Alquileres': { 'Moravia': null },
        'Otros ingresos': null,
        'Salario': { 'Primer Quincena': null, 'Segunda Quincena': null },
        'Salario Escolar': null,
        'Saldo inicial': null,
      },
      'Médicos': { 'Consultas': null, 'Dentista': null, 'Farmacia': null, 'Seguros Médicos': null },
      'Otros': { 'Imprevistos': null },
      'Personal': {
        'Gema': { 'Caja Chica': null },
        'Ian': { 'Caja Chica': null },
        'JoaKo': { 'Caja Chica': null },
        'Josué': { 'Caja Chica': null },
      },
      'Restaurantes y Otros': { 'Restaurantes': null },
      'Servicios Públicos': {
        'Administración de Cuentas': null,
        'Agua': null,
        'CNFL': null,
        'Colegiaturas': null,
        'CPIC': null,
        'Gastos Funerales': null,
        'Internet': { 'Kolbi': null, 'Metrocom': null },
        'Teléfonos': { 'Kolbi': null, 'Liberty': null },
      },
      'Social': {
        'Actividades Sociales': null,
        'Cumpleaños': null,
        'Donaciones': { 'World Vision': null },
        'Grupos': { 'G08': null, 'Kyriacos': null },
      },
      'Supermercado': { 'Feria del Agricultor': null, 'Supermercado': null },
      'Transporte': { 'Combustible': null, 'Mantenimiento': null, 'Peajes / Estacionamiento': null, 'Seguro': null, 'Taller': null, 'Uber / Taxi': null },
      'Vivienda': {
        'Alquiler / Hipoteca': { 'Alquiler Moravia': null },
        'Limpieza': { 'Aguinaldo': null },
        'Mantenimiento': { 'Municipalidad': { 'Tibás Urbano': null, 'Mantenimiento': null } },
      },
    };

    
    // Paleta base para categorías raíz (se asigna por orden, idempotente).
    const ROOT_PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#64748b','#0ea5e9','#10b981','#a855f7'];

    function clamp01(x){ return Math.max(0, Math.min(1, x)); }
    function hexToRgb(hex){
      const h = String(hex||'').replace('#','').trim();
      if (h.length !== 6) return null;
      const n = parseInt(h,16);
      return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
    }
    function rgbToHex(r,g,b){
      const to = (v)=> ('0'+Math.max(0,Math.min(255,Math.round(v))).toString(16)).slice(-2);
      return `#${to(r)}${to(g)}${to(b)}`;
    }
    // Genera un color "similar" (más claro) a partir del del padre, para herencia visual por niveles.
    function deriveChildColor(parentHex, depthStep=1){
      const rgb = hexToRgb(parentHex);
      if (!rgb) return parentHex;
      const mix = clamp01(0.12 * depthStep); // 12% por nivel hacia blanco
      const r = rgb.r + (255 - rgb.r) * mix;
      const g = rgb.g + (255 - rgb.g) * mix;
      const b = rgb.b + (255 - rgb.b) * mix;
      return rgbToHex(r,g,b);
    }

const ensureTree = (node, parentId = null, inheritedColor = null, depth = 0, rootIndex = { i: 0 }) => {
      if (!node) return;
      Object.keys(node).forEach((name) => {
        const child = node[name];
        const isRoot = (parentId == null);
        const colorForThis = isRoot ? ROOT_PALETTE[(rootIndex.i++) % ROOT_PALETTE.length] : deriveChildColor(inheritedColor, 1);
        const id = upsertCategory(String(name), parentId, colorForThis);
        if (child && typeof child === 'object') ensureTree(child, id, colorForThis, depth + 1, rootIndex);
      });
    };

    ensureTree(root, null, null, 0, { i: 0 });
  }

function loadDemoCategories() {
    // Árbol según lista del usuario (seeds idempotentes)
        const root = {
      'Bancarios': {
        'Fondos de Inversión': {
          'Fondo 01 - Alquiler': null,
          'Fondo 02 - Colones': null,
          'Fondo 03 - Dólares': null,
        }
      },
      'Departamentales': {
        'Hogar': null,
        'Regalos': null,
        'Tecnología': null,
        'JK Pro': null,
      },
      'Educación': {
        'Academia Rhema': null,
        'Actividades': null,
        'Colegio El Rosario': { 'Matrícula': null, 'Mensualidad': null, 'Útiles': null, 'Guardería': null },
      },
      'Entretenimiento': {
        'Deportes': { 'Mejenga': null },
        'Suscripciones': { 'ChatGPT': null, 'Disney Plus': null, 'IPTV': null, 'NBA': null, 'Netflix': null },
        'Vacaciones': { 'Paseos': null, 'Viajes': null },
      },
      'Ingresos': {
        'Aguinaldo': null,
        'Alquileres': { 'Moravia': null },
        'Otros ingresos': null,
        'Salario': { 'Primer Quincena': null, 'Segunda Quincena': null },
        'Salario Escolar': null,
        'Saldo inicial': null,
      },
      'Médicos': { 'Consultas': null, 'Dentista': null, 'Farmacia': null, 'Seguros Médicos': null },
      'Otros': { 'Imprevistos': null },
      'Personal': {
        'Gema': { 'Caja Chica': null },
        'Ian': { 'Caja Chica': null },
        'JoaKo': { 'Caja Chica': null },
        'Josué': { 'Caja Chica': null },
      },
      'Restaurantes y Otros': { 'Restaurantes': null },
      'Servicios Públicos': {
        'Administración de Cuentas': null,
        'Agua': null,
        'CNFL': null,
        'Colegiaturas': null,
        'CPIC': null,
        'Gastos Funerales': null,
        'Internet': { 'Kolbi': null, 'Metrocom': null },
        'Teléfonos': { 'Kolbi': null, 'Liberty': null },
      },
      'Social': {
        'Actividades Sociales': null,
        'Cumpleaños': null,
        'Donaciones': { 'World Vision': null },
        'Grupos': { 'G08': null, 'Kyriacos': null },
      },
      'Supermercado': { 'Feria del Agricultor': null, 'Supermercado': null },
      'Transporte': { 'Combustible': null, 'Mantenimiento': null, 'Peajes / Estacionamiento': null, 'Seguro': null, 'Taller': null, 'Uber / Taxi': null },
      'Vivienda': {
        'Alquiler / Hipoteca': { 'Alquiler Moravia': null },
        'Limpieza': { 'Aguinaldo': null },
        'Mantenimiento': { 'Municipalidad': { 'Tibás Urbano': null, 'Mantenimiento': null } },
      },
    };

    // Colores raíz (se heredan a hijos)
    const rootColors = {
      'Bancarios': '#0ea5e9',
      'Departamentales': '#f97316',
      'Educación': '#06b6d4',
      'Entretenimiento': '#a855f7',
      'Ingresos': '#22c55e',
      'Médicos': '#ef4444',
      'Otros': '#64748b',
      'Personal': '#eab308',
      'Restaurantes y Otros': '#f59e0b',
      'Servicios Públicos': '#3b82f6',
      'Social': '#ec4899',
      'Supermercado': '#84cc16',
      'Transporte': '#14b8a6',
      'Vivienda': '#8b5cf6',
    };

    function walk(obj, parentId, inheritedColor) {
      Object.keys(obj).forEach((name) => {
        const child = obj[name];
        const color = parentId == null ? (rootColors[name] || inheritedColor || '#64748b') : deriveChildColor(inheritedColor || '#64748b', 1);
        const id = upsertCategory(name, parentId, color);
        if (child && typeof child === 'object') walk(child, id, color);
      });
    }
    walk(root, null, null);
  }

  function insertDemoBudgets() {
    // Presupuestos demo para 12 meses (>=25 por mes)
    const t = nowIso();
    const endDate = new Date();
    const endYm = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}`;
    const monthsBack = 12;
    const periods = [];
    for (let i = monthsBack-1; i >= 0; i--) periods.push(addMonths(endYm, -i));

    const up = (period, categoryId, amount) => {
      if (!categoryId) return;
      run(`INSERT INTO budgets(period,type,category_id,currency,amount,is_recurring,active,created_at)
           VALUES (:p,'expense',:c,'CRC',:a,0,1,:t)
           ON CONFLICT(period,type,category_id,currency,is_recurring) DO UPDATE SET amount=excluded.amount, updated_at=:t`,
        { ':p': period, ':c': categoryId, ':a': amount, ':t': t }
      );
    };

    const leafCats = select(`
      SELECT c.id
      FROM categories c
      LEFT JOIN categories ch ON ch.parent_id = c.id
      WHERE c.active=1 AND ch.id IS NULL
      ORDER BY c.id
      LIMIT 80
    `).map(r => Number(r.id)).filter(Boolean);

    const cats = leafCats.length >= 25 ? leafCats : select('SELECT id FROM categories WHERE active=1 ORDER BY id LIMIT 80').map(r => Number(r.id));

    periods.forEach((p, mi) => {
      for (let i = 0; i < Math.min(25, cats.length); i++) {
        const amt = 25000 + (i * 7500) + (mi * 900); // sube un poco por mes
        up(p, cats[i], amt);
      }
    });
  }

  function insertDemoReconciliations() {
    // Conciliaciones demo: 5 cuentas x 12 periodos (sin cierres para demo estable)
    const t = nowIso();
    const accounts = [
      Number(scalar("SELECT id FROM accounts WHERE name='BAC Colones' LIMIT 1") || 0),
      Number(scalar("SELECT id FROM accounts WHERE name='BCR Colones' LIMIT 1") || 0),
      Number(scalar("SELECT id FROM accounts WHERE name='BN Colones' LIMIT 1") || 0),
      Number(scalar("SELECT id FROM accounts WHERE name='Promerica Colones' LIMIT 1") || 0),
      Number(scalar("SELECT id FROM accounts WHERE name='Billetera jksotorojas' LIMIT 1") || 0),
    ].filter(Boolean);

    const endDate = new Date();
    const endYm = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}`;
    const monthsBack = 12;
    const periods = [];
    for (let i = monthsBack-1; i >= 0; i--) periods.push(addMonths(endYm, -i));

    accounts.forEach((aid) => {
      periods.forEach((p) => {
        run(`INSERT OR IGNORE INTO reconciliations(period,account_id,bank_ending,closed,created_at,updated_at)
             VALUES (:p,:a,0,0,:t,:t)`, { ':p': p, ':a': aid, ':t': t });
      });
    });
  }

  function insertDemoSavingsGoalsAndMovements() {
    const t = nowIso();
    // Metas (3)
    const ensureGoal = (name, currency, target) => {
      return Number(scalar('SELECT id FROM savings_goals WHERE name=:n LIMIT 1', { ':n': name }) || 0)
        || (run('INSERT INTO savings_goals(name,currency,target,active,created_at) VALUES (:n,:c,:tg,1,:t)',
          { ':n': name, ':c': currency, ':tg': target, ':t': t }),
          Number(scalar('SELECT id FROM savings_goals WHERE name=:n LIMIT 1', { ':n': name }) || 0));
    };

    const g1 = ensureGoal('Fondo 02 - Colones', 'CRC', 500000);
    const g2 = ensureGoal('Fondo 03 - Dólares', 'USD', 1000);
    ensureGoal('Fondo 01 - Alquiler', 'CRC', 350000);

    const accFrom = Number(scalar("SELECT id FROM accounts WHERE name='BAC Colones' LIMIT 1") || 0);
    const accTo = Number(scalar("SELECT id FROM accounts WHERE name='Ahorros Colones' LIMIT 1") || 0);
    const cat = findCategoryIdByName('Fondo 02 - Colones', findCategoryIdByName('Fondos de Inversión', findCategoryIdByName('Bancarios', null)));
    if (!accFrom || !accTo) return;

    const endDate = new Date();
    const endYm = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}`;
    const monthsBack = 12;
    const periods = [];
    for (let i = monthsBack-1; i >= 0; i--) periods.push(addMonths(endYm, -i));

    const ins = (date, amount, kind, goalId, acc1, acc2, catId, desc, refId = null) => {
      const period = toPeriod(date);
      run(`INSERT INTO movements
        (type,date,period,account_id,account_to_id,category_id,amount,description,is_split,is_opening,is_savings,savings_kind,goal_id,savings_ref_id,created_at)
        VALUES ('transfer',:d,:p,:a1,:a2,:c,:amt,:desc,0,0,1,:k,:g,:rid,:t)`,
        { ':d': date, ':p': period, ':a1': acc1, ':a2': acc2, ':c': catId || null, ':amt': amount, ':desc': desc || 'Demo ahorro', ':k': kind, ':g': goalId || null, ':rid': refId, ':t': t }
      );
      return Number(scalar('SELECT last_insert_rowid()') || 0);
    };

    // 2 depósitos por mes + algunos retiros trimestrales (CRC)
    const deposits = [];
    periods.forEach((p, mi) => {
      const d1 = ins(`${p}-05`, 15000 + (mi*500), 'deposit', g1, accFrom, accTo, cat, 'Demo ahorro', null);
      const d2 = ins(`${p}-20`, 18000 + (mi*600), 'deposit', g1, accFrom, accTo, cat, 'Demo ahorro', null);
      if (d1) deposits.push(d1);
      if (d2) deposits.push(d2);

      if (mi % 3 === 2) {
        const refId = deposits[Math.max(0, deposits.length-2)] || null;
        ins(`${p}-25`, 7000 + (mi*250), 'withdraw', g1, accFrom, accTo, cat, 'Demo retiro ahorro', refId);
      }
    });

    // USD: 1 depósito por mes si existe cuenta
    const accFromUsd = Number(scalar("SELECT id FROM accounts WHERE name='BAC Dólares' LIMIT 1") || 0);
    const accToUsd = Number(scalar("SELECT id FROM accounts WHERE name='Ahorros Dólares' LIMIT 1") || 0);
    if (accFromUsd && accToUsd) {
      const catUsd = findCategoryIdByName('Fondo 03 - Dólares', findCategoryIdByName('Fondos de Inversión', findCategoryIdByName('Bancarios', null)));
      periods.forEach((p, mi) => {
        ins(`${p}-10`, 40 + (mi*3), 'deposit', g2, accFromUsd, accToUsd, catUsd, 'Demo ahorro USD', null);
        if (mi % 4 === 3) ins(`${p}-22`, 15 + (mi*2), 'withdraw', g2, accFromUsd, accToUsd, catUsd, 'Demo retiro USD', null);
      });
    }
  }

  function insertDemoMovements() {
    const t = nowIso();
    const endDate = new Date();
    const endYm = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}`;
    const monthsBack = 12; // demo grande (mínimo 12 meses)
    const periods = [];
    for (let i = monthsBack-1; i >= 0; i--) periods.push(addMonths(endYm, -i));

    const aBAC = Number(scalar("SELECT id FROM accounts WHERE name='BAC Colones' LIMIT 1") || 0);
    const aBCR = Number(scalar("SELECT id FROM accounts WHERE name='BCR Colones' LIMIT 1") || 0);
    const aTarj = Number(scalar("SELECT id FROM accounts WHERE name='BAC Walmart Colones' LIMIT 1") || 0);
    const aWallet = Number(scalar("SELECT id FROM accounts WHERE name='Billetera jksotorojas' LIMIT 1") || 0)
      || Number(scalar("SELECT id FROM accounts WHERE name='Billetera jksotorojas' AND parent_id=(SELECT id FROM accounts WHERE name='Billeteras' LIMIT 1) LIMIT 1") || 0);

    const catIncome = findCategoryIdByName('Primer Quincena', findCategoryIdByName('Salario', findCategoryIdByName('Ingresos', null)));
    const catSuper = findCategoryIdByName('Supermercado', findCategoryIdByName('Supermercado', null)) || findCategoryIdByName('Supermercado', null);
    const catServices = findCategoryIdByName('CNFL', findCategoryIdByName('Servicios Públicos', null)) || findCategoryIdByName('Servicios Públicos', null);
    const catSubs = findCategoryIdByName('Netflix', findCategoryIdByName('Suscripciones', findCategoryIdByName('Entretenimiento', null)))
      || findCategoryIdByName('Suscripciones', findCategoryIdByName('Entretenimiento', null));
    const catRest = findCategoryIdByName('Restaurantes y Otros', null) || findCategoryIdByName('Restaurantes', null);
    const catTrans = findCategoryIdByName('Transporte', null);

    const templates = [
      { type: 'expense', cat: catSuper, desc: 'Supermercado (demo)' },
      { type: 'expense', cat: catServices, desc: 'Servicios públicos (demo)' },
      { type: 'expense', cat: catSubs, desc: 'Suscripción (demo)' },
      { type: 'expense', cat: catRest, desc: 'Restaurante (demo)' },
      { type: 'expense', cat: catTrans, desc: 'Transporte (demo)' },
    ];

    const accounts = [
      { id: aBAC, name: 'BAC Colones' },
      { id: aBCR, name: 'BCR Colones' },
      { id: aTarj, name: 'BAC Walmart Colones' },
      { id: aWallet, name: 'Billetera jksotorojas' },
    ].filter(a => a.id);

    const ins = (type, date, accountId, amount, categoryId, desc, accountToId = null) => {
      if (!accountId) return;
      const period = toPeriod(date);
      run(`INSERT INTO movements(type,date,period,account_id,account_to_id,category_id,amount,description,is_split,is_opening,is_savings,created_at)
           VALUES (:type,:d,:p,:a,:ato,:c,:amt,:desc,0,0,0,:t)`,
        { ':type': type, ':d': date, ':p': period, ':a': accountId, ':ato': accountToId, ':c': categoryId || null, ':amt': amount, ':desc': desc || '', ':t': t }
      );
    };

    // Generación determinista por mes (incomes + gastos + transferencias)
    periods.forEach((p, mi) => {
      const [y, m] = p.split('-');
      const base = mi * 17;

      // 2 ingresos por mes
      if (aBAC && catIncome) {
        ins('income', `${p}-15`, aBAC, 850000 + (base * 900), catIncome, 'Salario (demo)');
        ins('income', `${p}-28`, aBAC, 820000 + (base * 700), catIncome, 'Salario (demo)');
      }

      // 28 gastos por mes
      for (let i = 0; i < 28; i++) {
        const day = String(1 + ((i * 3 + base) % 27)).padStart(2, '0');
        const date = `${p}-${day}`;
        const tpl = templates[(i + base) % templates.length];
        const acc = accounts[(i + base) % accounts.length];
        const amt = 3500 + ((i + base) * 1200);

        // evita ingresos en tarjetas/billetera; para gastos sí permite
        const accountId = acc.id;
        ins('expense', date, accountId, amt, tpl.cat, tpl.desc);
      }

      // 2 transferencias por mes (BAC -> billetera)
      if (aWallet && aBAC) {
        ins('transfer', `${p}-02`, aBAC, 20000 + (mi * 800), null, 'Efectivo (demo)', aWallet);
        ins('transfer', `${p}-16`, aBAC, 15000 + (mi * 600), null, 'Efectivo (demo)', aWallet);
      }
    });
  }

  async function loadBase() {
    try {
      await ensureBaseTypes();
      loadBaseAccounts();
      loadBaseCategories();
      await window.SGF.db.save();
      toast('Base cargada: tipos + cuentas base + categorías predeterminadas + ahorros predeterminados.');
    } catch (e) {
      console.error(e);
      toast(e?.message || 'No se pudo cargar base.');
    }
  }

  async function loadDemo() {
    try {
      await ensureBaseTypes();
      loadBaseAccounts();
      loadDemoCategories();
      // Importante: insertar movimientos ANTES de crear conciliaciones cerradas (trigger bloquea INSERT en meses cerrados).
      insertDemoMovements();
      insertDemoSavingsGoalsAndMovements();
      insertDemoBudgets();
      insertDemoReconciliations();

      // Asegurar derivados FX/base_amount para reportes/presupuestos
      try { recomputeFxDerived(); } catch (e) { console.warn(e); }

      await window.SGF.db.save();
      toast('Demo cargada (XL): 14 meses de movimientos + 10 meses de ahorros + 8 meses de presupuestos + conciliaciones.');
      // refrescar módulos si están montados
      window.SGF?.closureGuard?.invalidate?.();
      try { window.SGF.modules?.movimientos?.onMount?.(); } catch (_) {}
      try { window.SGF.modules?.ahorros?.onMount?.(); } catch (_) {}
      try { window.SGF.modules?.presupuestos?.onMount?.(); } catch (_) {}
      try { window.SGF.modules?.conciliacion?.onMount?.(); } catch (_) {}
    } catch (e) {
      console.error(e);
      toast(e?.message || 'No se pudo cargar demo.');
    }
  }

  function normalizePeriods() {
    const rows = select("SELECT id,date,period FROM movements");
    let fixed = 0;
    rows.forEach(r => {
      const p = toPeriod(r.date);
      if (p && String(r.period || '') !== p) {
        run('UPDATE movements SET period=:p WHERE id=:id', { ':p': p, ':id': r.id });
        fixed++;
      }
    });
    return fixed;
  }

  function recomputeFxDerived() {
    // v1.16: recalcular base_amount / amount_to usando histórico USD->CRC (y su inversa)
    const baseCur = window.SGF.fx?.baseCurrency?.() || 'CRC';

    const rows = select(`
      SELECT m.id, m.type, m.date, m.period, m.account_id, m.account_to_id, m.amount,
             COALESCE(m.currency,'') AS currency,
             COALESCE(m.fx_rate,0) AS fx_rate,
             m.amount_to
      FROM movements m
    `);

    if (!rows.length) return { updated: 0 };

    let updated = 0;
    const upd = window.SGF.sqlDb.prepare(`
      UPDATE movements
      SET currency=:cur, fx_rate=:fx, amount_to=:amt_to, base_amount=:base, updated_at=:u
      WHERE id=:id
    `);

    const t = nowIso();
    rows.forEach(r => {
      const id = Number(r.id);
      const dateIso = String(r.date || '').slice(0,10);
      const amt = Number(r.amount || 0);

      const accCur = (select('SELECT currency FROM accounts WHERE id=:id', {':id': Number(r.account_id)} )[0]?.currency) || 'CRC';
      const toCur = r.account_to_id ? ((select('SELECT currency FROM accounts WHERE id=:id', {':id': Number(r.account_to_id)} )[0]?.currency) || 'CRC') : null;

      let cur = (String(r.currency || '').trim() || accCur);
      let fx = Number(r.fx_rate || 0);
      let amtTo = (r.amount_to == null ? null : Number(r.amount_to));

      if (String(r.type) === 'transfer' && toCur && toCur !== cur) {
        const suggested = window.SGF.fx?.rate?.(dateIso, cur, toCur) || 0;
        if (!Number.isFinite(fx) || fx <= 0) fx = Number(suggested || 0);
        if (Number.isFinite(fx) && fx > 0) amtTo = Number(round2(amt * fx));
      } else if (String(r.type) === 'transfer') {
        fx = 1;
        amtTo = Number(round2(amt));
      } else {
        fx = 1;
        amtTo = null;
      }

      const toBase = (cur === baseCur) ? 1 : (window.SGF.fx?.rate?.(dateIso, cur, baseCur) || 0);
      const base = Number(round2(amt * Number(toBase || 0)));

      upd.bind({ ':cur': cur, ':fx': Number(fx || 1), ':amt_to': amtTo, ':base': base, ':u': t, ':id': id });
      try { upd.step(); } catch (e) {
        const msg = String(e && (e.message || e)).toUpperCase();
        if (msg.includes('MONTH_CLOSED')) { upd.reset(); return; }
        throw e;
      }
      upd.reset();
      updated += 1;
    });

    upd.free();
    return { updated };
  }

  function cleanupOrphans() {
    // Limpia splits huérfanos
    const s1 = run(`DELETE FROM movement_splits
                    WHERE movement_id NOT IN (SELECT id FROM movements)`);
    // Movimientos con cuenta faltante (debería ser raro)
    const m1 = run(`DELETE FROM movements
                    WHERE account_id NOT IN (SELECT id FROM accounts)`);
    // Budgets con categoría faltante
    const b1 = run(`DELETE FROM budgets
                    WHERE category_id NOT IN (SELECT id FROM categories)`);
    // Reconciliations con cuenta faltante
    const r1 = run(`DELETE FROM reconciliations
                    WHERE account_id NOT IN (SELECT id FROM accounts)`);
    return { splitOrphans: s1, movementOrphans: m1, budgetOrphans: b1, recOrphans: r1 };
  }

  async function diagnoseRepair() {
    try {
      // Re-aplicar migraciones (incluye índices/triggers)
      ensureBaseTypes();
      const periodFix = normalizePeriods();
      const fxFix = recomputeFxDerived();
      const orphan = cleanupOrphans();

      // Foreign key check (informativo)
      let fkIssues = 0;
      try {
        const fk = select('PRAGMA foreign_key_check');
        fkIssues = fk.length;
      } catch (_) {}

      await window.SGF.db.save();
      const msg = `Diagnóstico listo. Periodos corregidos: ${periodFix}. ` +
        `Huérfanos: splits ${orphan.splitOrphans}, mov ${orphan.movementOrphans}, presup ${orphan.budgetOrphans}, conc ${orphan.recOrphans}. ` +
        (fkIssues ? `FK pendientes: ${fkIssues} (ver consola).` : 'Sin FK pendientes.');
      toast(msg);
      if (fkIssues) console.warn('foreign_key_check', select('PRAGMA foreign_key_check'));

      window.SGF?.closureGuard?.invalidate?.();
    } catch (e) {
      console.error(e);
      toast(e?.message || 'No se pudo diagnosticar/reparar.');
    }
  }

  async function resetFull() {
    const username = window.SGF?.session?.username;
    const password = window.SGF?.session?.password;
    if (!username || !password) {
      toast('No hay sesión activa.');
      return;
    }
    const ok = await (window.SGF.uiConfirm?.({
      title: 'Reset completo',
      message: 'Esto recrea la bóveda del usuario actual desde 0. Se perderán datos locales de este usuario en este dispositivo. ¿Continuar?',
      confirmText: 'Recrear',
      cancelText: 'Cancelar',
      danger: true,
    }) ?? Promise.resolve(confirm('¿Reset completo? Esto borra los datos locales del usuario actual.')));
    if (!ok) return;

    try {
      await window.SGF.vault.createUser(username, password, { overwrite: true });
      // Migraciones/seed base
      await window.SGF.migrate?.ensureAll?.();
    // Si por algún motivo migrate no está disponible aún, aseguramos tipos base aquí.
    try {
      const cnt = Number(scalar('SELECT COUNT(1) AS c FROM account_types') || 0);
      if (!cnt) {
        const base = ['Banco', 'Tarjeta', 'Ahorros', 'Efectivo'];
        base.forEach(n => run('INSERT OR IGNORE INTO account_types(name,is_base,active) VALUES (:n,1,1)', {':n': n}));
      }
    } catch (_) {}
      ensureSavingsDefaults();
      await window.SGF.db.save();
      toast('Bóveda recreada.');
      // Recargar UI para evitar estados colgados
      setTimeout(() => window.location.reload(), 250);
    } catch (e) {
      console.error(e);
      toast(e?.message || 'No se pudo recrear la bóveda.');
    }
  }

  window.SGF.maintenance = {
    loadDemo,
    loadBase,
    diagnoseRepair,
    resetFull,
  };
})();