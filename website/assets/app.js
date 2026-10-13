'use strict';

// 页面只读取已有数据文件，不连接券商，不计算交易信号。
const SIGNAL_TYPES = {
  support: { name: '支撑反弹', inverse: '倒数支撑反弹', detail: '价格支撑反弹／突破后回踩' },
  trendStart: { name: '趋势启动', inverse: '倒数趋势启动', detail: '收复均线／金叉转强' },
  breakout: { name: '放量突破', inverse: '倒数放量突破', detail: '前高突破／区间突破' },
  pullback: { name: '多头回踩', inverse: '倒数多头回踩', detail: '多头排列中的均线回踩' },
  earlyExit: { name: '高乖离后转弱', detail: '止盈观察', intent: 'take-profit-watch' }
};
const MARKETS = { CN: 'A股', HK: '港股', US: '美股', JP: '日股', KR: '韩股', CRYPTO: '加密货币' };
const SESSIONS = { regular: '交易中', pre: '盘前交易', post: '盘后交易', closed: '已收盘或休市', break: '午间休市', continuous: '全天交易', unknown: '交易状态未知' };
const TABLES = { macro: 'macro-rows', sectors: 'sector-rows', stocks: 'stock-rows', profit: 'profit-rows', stop: 'stop-rows' };
const state = { data: null, history: [], market: 'all', query: '', page: 1, size: 12, activeId: '', controller: null, requestId: 0, pendingId: '' };
const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const numberFormatter = new Map();

function formatNumber(value, decimals = 2, percent = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const precision = Math.max(0, Math.min(6, decimals));
  if (!numberFormatter.has(precision)) numberFormatter.set(precision, new Intl.NumberFormat('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision }));
  return `${percent && value > 0 ? '+' : ''}${numberFormatter.get(precision).format(value)}${percent ? '%' : ''}`;
}

function formatTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

function signalMarkup(signal) {
  const type = SIGNAL_TYPES[signal.type];
  if (!type) return '';
  const isExit = type.intent === 'take-profit-watch';
  const down = isExit || signal.direction === 'short';
  const label = isExit ? '高乖离后转弱 · 止盈观察' : down ? `${type.inverse} · 原图做空候选` : `${type.name} · ${type.detail}`;
  const timeframe = signal.timeframe ? ` · ${signal.timeframe}` : '';
  return `<span class="signal ${signal.type}${down ? ' short' : ''}" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label + timeframe)}"${isExit ? ' data-intent="take-profit-watch"' : ''}><svg viewBox="0 0 14 12" aria-hidden="true"><path d="M7 0 14 12H0Z"/></svg></span>`;
}

function assetMarkup(row) {
  const session = Object.hasOwn(SESSIONS, row.session) ? row.session : 'unknown';
  const title = `${SESSIONS[session]} · 报价时间 ${formatTime(row.quoteAt)}（北京时间）`;
  const subtitle = ['CN', 'HK', 'JP', 'KR'].includes(row.market) && row.name ? `<span class="asset-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>` : '';
  return `<div class="asset"><span class="session ${session}" role="img" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"></span><div class="asset-copy"><span class="ticker-line"><span class="ticker" title="${escapeHtml(row.name || row.ticker)}">${escapeHtml(row.ticker)}</span><span class="market-chip">${escapeHtml(MARKETS[row.market])}</span></span>${subtitle}</div></div>`;
}

function earningsMarkup(row) {
  if (!row.earnings?.date) return '<td class="earnings">—</td>';
  const earnings = row.earnings;
  const date = earnings.date.slice(5);
  const days = Math.round((Date.parse(`${earnings.date}T12:00:00Z`) - Date.parse(`${state.data.updatedAt.slice(0, 10)}T12:00:00Z`)) / 86400000);
  const label = `${earnings.status === 'confirmed' ? '已确认' : '预计'}${earnings.session ? ' · ' + earnings.session : ''}`;
  return `<td class="earnings${days >= 0 && days <= 7 ? ' earnings-soon' : ''}" title="${escapeHtml(earnings.date + ' · 标的当地日期 · ' + label)}">${escapeHtml(date)}<div class="earnings-note">${escapeHtml(label)}</div></td>`;
}

function rowMarkup(row, section) {
  const changeClass = row.changePct > 0 ? 'positive' : row.changePct < 0 ? 'negative' : 'unchanged';
  const price = formatNumber(row.price, row.decimals ?? 2) + (row.priceUnit === 'percent' ? '%' : '');
  const signals = row.signals.map(signalMarkup).join('');
  const tail = section === 'profit' || section === 'stop' ? `<td class="rule-cell"><span class="rule" title="${escapeHtml(row.ruleDetail || row.rule)}">${escapeHtml(row.rule)}</span></td>` : `<td class="col-signal"><span class="signal-group">${signals || '<span class="unchanged">—</span>'}</span></td>`;
  return `<tr data-id="${escapeHtml(row.id)}" data-market="${escapeHtml(row.market)}"><td>${assetMarkup(row)}</td><td class="numeric price-value" title="${escapeHtml(row.priceUnit === 'percent' ? '收益率' : row.currency)}">${price}</td><td class="numeric change-value ${changeClass}" title="${escapeHtml(row.changeBasis)}">${formatNumber(row.changePct, 2, true)}</td>${tail}${section === 'stocks' ? earningsMarkup(row) : ''}</tr>`;
}

function matches(row) {
  const marketMatches = state.market === 'all' || row.market === state.market;
  const text = [row.ticker, row.name, row.market, MARKETS[row.market], ...(row.aliases || [])].join(' ').toLowerCase();
  return marketMatches && (!state.query || text.includes(state.query));
}

function render() {
  if (!state.data) return;
  for (const [section, target] of Object.entries(TABLES)) {
    let rows = state.data[section].filter(matches);
    if (section === 'stocks') {
      const count = rows.length;
      const size = state.size === 'all' ? Math.max(count, 1) : state.size;
      const pages = Math.max(1, Math.ceil(count / size));
      state.page = Math.min(state.page, pages);
      const start = (state.page - 1) * size;
      rows = rows.slice(start, start + size);
      byId('stock-range').textContent = count ? `${start + 1}–${Math.min(start + size, count)} / ${count}` : '0 / 0';
      byId('page-number').textContent = `${state.page} / ${pages}`;
      byId('previous-page').disabled = state.page <= 1;
      byId('next-page').disabled = state.page >= pages;
      byId('stock-pagination').hidden = count === 0;
    }
    const body = byId(target);
    body.innerHTML = rows.map(row => rowMarkup(row, section)).join('');
    body.closest('.table-wrap').querySelector('.empty-state').hidden = rows.length > 0;
  }
  byId('clear-search').hidden = !state.query;
}

function validateData(data) {
  if (data.schemaVersion !== 1 || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error('数据版本或更新时间无效');
  for (const section of Object.keys(TABLES)) {
    if (!Array.isArray(data[section])) throw new Error('缺少表格数据');
    const ids = new Set();
    for (const row of data[section]) {
      if (!row.id || ids.has(row.id) || !row.ticker || !Object.hasOwn(MARKETS, row.market) || !Array.isArray(row.signals)) throw new Error('标的数据格式无效');
      if (row.signals.some(signal => !Object.hasOwn(SIGNAL_TYPES, signal.type) || !['long', 'short'].includes(signal.direction))) throw new Error('信号格式无效');
      if (!Number.isFinite(row.price) || !Number.isFinite(row.changePct) || !Number.isFinite(Date.parse(row.quoteAt))) throw new Error('价格或报价时间无效');
      ids.add(row.id);
    }
  }
}

async function getJson(path, signal) {
  const response = await fetch(new URL(path, document.baseURI), { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`数据读取失败：${response.status}`);
  return response.json();
}

function showMessage(text, error = false) {
  byId('load-text').textContent = text;
  byId('load-message').classList.toggle('error', error);
  byId('load-message').hidden = !text;
  byId('retry-load').hidden = !error;
}

async function loadSnapshot(id) {
  const entry = state.history.find(item => item.id === id);
  if (!entry) return;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const requestId = ++state.requestId;
  state.pendingId = id;
  byId('dashboard').setAttribute('aria-busy', 'true');
  showMessage('正在读取数据…');
  try {
    const data = await getJson(entry.path, controller.signal);
    validateData(data);
    if (requestId !== state.requestId) return;
    state.data = data;
    state.activeId = id;
    state.pendingId = '';
    state.page = 1;
    byId('snapshot-select').value = id;
    render();
    showMessage('');
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== state.requestId) return;
    if (state.activeId) byId('snapshot-select').value = state.activeId;
    showMessage(state.data ? '该时点暂时无法读取，当前仍显示上一次成功加载的结果。' : '数据暂时无法读取，请重试。', true);
  } finally {
    if (requestId === state.requestId) byId('dashboard').setAttribute('aria-busy', 'false');
  }
}

async function initialize() {
  if (location.protocol === 'file:') {
    showMessage('请通过本地预览服务或GitHub Pages打开此页面，以读取独立数据文件。');
    byId('snapshot-select').innerHTML = '<option>尚未读取数据</option>';
    byId('dashboard').setAttribute('aria-busy', 'false');
    return;
  }
  try {
    showMessage('正在读取数据…');
    const history = await getJson('data/history.json');
    if (history.schemaVersion !== 1 || !Array.isArray(history.snapshots) || !history.snapshots.length) throw new Error('运行记录为空');
    if (history.snapshots.some(entry => !entry.id || !Number.isFinite(Date.parse(entry.updatedAt)) || !/^data\/[a-zA-Z0-9_./-]+\.json$/.test(entry.path) || entry.path.includes('..'))) throw new Error('运行记录无效');
    state.history = history.snapshots;
    byId('snapshot-select').innerHTML = state.history.map((entry, index) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(formatTime(entry.updatedAt))}${index === 0 ? ' · 最新' : ''}</option>`).join('');
    await loadSnapshot(state.history[0].id);
  } catch (error) {
    showMessage('运行记录暂时无法读取，请重试。', true);
    byId('dashboard').setAttribute('aria-busy', 'false');
  }
}

document.querySelectorAll('.market-tab').forEach(button => button.addEventListener('click', () => {
  state.market = button.dataset.market;
  state.page = 1;
  document.querySelectorAll('.market-tab').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  render();
}));
byId('asset-search').addEventListener('input', event => { state.query = event.target.value.trim().toLowerCase(); state.page = 1; render(); });
byId('clear-search').addEventListener('click', () => { state.query = ''; state.page = 1; byId('asset-search').value = ''; render(); byId('asset-search').focus(); });
byId('snapshot-select').addEventListener('change', event => loadSnapshot(event.target.value));
byId('page-size').addEventListener('change', event => { state.size = event.target.value === 'all' ? 'all' : Number(event.target.value); state.page = 1; render(); });
byId('previous-page').addEventListener('click', () => { if (state.page > 1) { state.page--; render(); } });
byId('next-page').addEventListener('click', () => { state.page++; render(); });
byId('retry-load').addEventListener('click', () => state.history.length ? loadSnapshot(state.pendingId || state.activeId || state.history[0].id) : initialize());
byId('print-button').addEventListener('click', () => window.print());
// 打印当前筛选下的全部个股，而不是仅打印当前分页。
let beforePrint = null;
window.addEventListener('beforeprint', () => { beforePrint = { size: state.size, page: state.page }; state.size = 'all'; state.page = 1; render(); });
window.addEventListener('afterprint', () => { if (beforePrint) { Object.assign(state, beforePrint); beforePrint = null; render(); } });
initialize();
