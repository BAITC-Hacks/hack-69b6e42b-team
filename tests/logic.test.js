const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

let seq = 0;
function make(category, amountMinor, date = '2026-09-10') {
  seq += 1;
  return {
    id: `id-${seq}`,
    amount: amountMinor,
    category,
    date,
    description: '',
    createdAt: seq,
  };
}
const T = (tenge) => tenge * 100;

test('проверочный пример из ТЗ (раздел 7)', () => {
  const food1 = make('food', T(1500));
  const transport = make('transport', T(600));
  const food2 = make('food', T(900));

  let list = [];
  list = L.addExpense(list, food1);
  list = L.addExpense(list, transport);
  list = L.addExpense(list, food2);

  const s1 = L.summarize(L.expensesForMonth(list, '2026-09'));
  assert.equal(s1.total, T(3000));
  assert.deepEqual(
    s1.byCategory.map((c) => [c.id, c.amount]),
    [['food', T(2400)], ['transport', T(600)]]
  );

  list = L.removeExpense(list, food2.id);
  const s2 = L.summarize(L.expensesForMonth(list, '2026-09'));
  assert.equal(s2.total, T(2100));
  assert.equal(s2.byCategory.find((c) => c.id === 'food').amount, T(1500));
});

test('сумма по категориям равна общему итогу (дробные суммы)', () => {
  const list = [make('food', 10), make('food', 20), make('fun', 19999), make('other', 1)];
  const s = L.summarize(list);
  const sumCats = s.byCategory.reduce((acc, c) => acc + c.amount, 0);
  assert.equal(sumCats, s.total);
  assert.equal(L.formatAmount(s.total).replace(/\s/g, ' '), '200,3 ₸');
});

test('фильтр по месяцу и смена месяца', () => {
  const list = [make('food', T(100), '2026-08-31'), make('food', T(200), '2026-09-01'), make('study', T(50), '2026-09-30')];
  assert.equal(L.summarize(L.expensesForMonth(list, '2026-09')).total, T(250));
  assert.equal(L.summarize(L.expensesForMonth(list, '2026-08')).total, T(100));
  assert.equal(L.summarize(L.expensesForMonth(list, '2026-10')).total, 0);
});

test('пустой список', () => {
  assert.deepEqual(L.summarize([]), { total: 0, count: 0, byCategory: [] });
});

test('список отсортирован: свежие даты сверху', () => {
  const list = [make('food', 1, '2026-09-02'), make('food', 1, '2026-09-20'), make('food', 1, '2026-09-02')];
  const ordered = L.expensesForMonth(list, '2026-09').map((e) => e.id);
  assert.deepEqual(ordered, [list[1].id, list[2].id, list[0].id]);
});

test('add/remove не мутируют исходный массив', () => {
  const original = [make('food', T(10))];
  const snapshot = JSON.stringify(original);
  L.addExpense(original, make('food', T(5)));
  L.removeExpense(original, original[0].id);
  assert.equal(JSON.stringify(original), snapshot);
});

test('parseAmount: корректные значения', () => {
  assert.deepEqual(L.parseAmount('1500'), { ok: true, value: 150000 });
  assert.deepEqual(L.parseAmount('1 500'), { ok: true, value: 150000 });
  assert.deepEqual(L.parseAmount('350,5'), { ok: true, value: 35050 });
  assert.deepEqual(L.parseAmount('0.01'), { ok: true, value: 1 });
  assert.deepEqual(L.parseAmount(' 99.99 '), { ok: true, value: 9999 });
});

test('parseAmount: отклоняет неверные значения', () => {
  for (const bad of ['', '   ', '0', '0,00', '-5', 'abc', '12.345', '1e5', '1,2,3', 'NaN', 'Infinity', '100000000.01', '99999999999999999999']) {
    const r = L.parseAmount(bad);
    assert.equal(r.ok, false, `ожидалась ошибка для "${bad}"`);
    assert.equal(typeof r.error, 'string');
  }
});

test('validateExpenseInput: собирает ошибки по всем полям', () => {
  const r = L.validateExpenseInput({ amount: '-1', category: '', date: '2026-02-30', description: 'x'.repeat(121) });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['amount', 'category', 'date', 'description']);
});

test('validateExpenseInput: описание необязательно', () => {
  const r = L.validateExpenseInput({ amount: '600', category: 'transport', date: '2026-09-15' });
  assert.deepEqual(r, { ok: true, value: { amount: 60000, category: 'transport', date: '2026-09-15', description: '' } });
});

test('validateExpenseInput: неизвестная категория и неверная дата', () => {
  const r = L.validateExpenseInput({ amount: '1', category: 'casino', date: '15.09.2026' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.category);
  assert.ok(r.errors.date);
});

test('sanitizeStoredExpenses: отбрасывает повреждённые записи', () => {
  const good = make('food', T(10));
  const data = [
    good,
    { ...good, id: 'x1', amount: -5 },
    { ...good, id: 'x2', amount: 1.5 },
    { ...good, id: 'x3', category: 'hack' },
    { ...good, id: 'x4', date: '2026-13-01' },
    null,
    'string',
  ];
  const r = L.sanitizeStoredExpenses(data);
  assert.deepEqual(r.expenses, [good]);
  assert.equal(r.dropped, 6);
  assert.deepEqual(L.sanitizeStoredExpenses({ not: 'array' }), { expenses: [], dropped: 0 });
});

test('isValidMonthString', () => {
  assert.equal(L.isValidMonthString('2026-09'), true);
  assert.equal(L.isValidMonthString('2026-13'), false);
  assert.equal(L.isValidMonthString(''), false);
});
