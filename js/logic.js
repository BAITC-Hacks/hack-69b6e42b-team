/*
 * Чистая логика учёта расходов: валидация, фильтрация по месяцу, итоги.
 * Не зависит от DOM и localStorage — поэтому покрыта unit-тестами (tests/logic.test.js).
 *
 * Суммы хранятся в тиынах (целое число, 1 ₸ = 100 тиын), чтобы избежать ошибок
 * округления float: сумма по категориям всегда точно равна общему итогу.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ExpenseLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CURRENCY = '₸';
  const MINOR_PER_MAJOR = 100;
  const MAX_AMOUNT_MINOR = 100000000 * MINOR_PER_MAJOR; // 100 000 000 ₸
  const DESCRIPTION_MAX_LENGTH = 120;
  const MIN_YEAR = 2000;
  const MAX_YEAR = 2100;

  const CATEGORIES = Object.freeze([
    { id: 'food', label: 'Еда', color: '#e4572e' },
    { id: 'transport', label: 'Транспорт', color: '#2e86ab' },
    { id: 'housing', label: 'Жильё', color: '#8a5a44' },
    { id: 'study', label: 'Учёба', color: '#6a4c93' },
    { id: 'mobile', label: 'Связь и интернет', color: '#1b998b' },
    { id: 'fun', label: 'Развлечения', color: '#f3a712' },
    { id: 'health', label: 'Здоровье', color: '#c03f7a' },
    { id: 'clothes', label: 'Одежда', color: '#3d5a80' },
    { id: 'other', label: 'Другое', color: '#7d7d7d' },
  ]);

  const CATEGORY_BY_ID = Object.freeze(
    CATEGORIES.reduce((acc, c) => ({ ...acc, [c.id]: c }), {})
  );

  function fail(error) {
    return { ok: false, error };
  }

  /** "1 500,50" → 150050 (тиын). Принимает пробелы между разрядами и запятую. */
  function parseAmount(raw) {
    const text = String(raw ?? '').trim().replace(/[\s ]/g, '').replace(',', '.');
    if (text === '') return fail('Введите сумму.');
    if (text.startsWith('-')) return fail('Сумма должна быть больше нуля.');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      return fail('Сумма — это число, не больше 2 знаков после запятой (например, 1500 или 350,50).');
    }
    const [whole, fraction = ''] = text.split('.');
    const minor = Number(whole) * MINOR_PER_MAJOR + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) {
      return fail(`Слишком большая сумма. Максимум — ${formatAmount(MAX_AMOUNT_MINOR)}.`);
    }
    if (minor <= 0) return fail('Сумма должна быть больше нуля.');
    return { ok: true, value: minor };
  }

  function isValidDateString(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    if (y < MIN_YEAR || y > MAX_YEAR) return false;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }

  function isValidMonthString(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && isValidDateString(`${value}-01`);
  }

  function parseDate(raw) {
    const text = String(raw ?? '').trim();
    if (text === '') return fail('Укажите дату.');
    if (!isValidDateString(text)) return fail(`Некорректная дата. Допустимы даты с ${MIN_YEAR} по ${MAX_YEAR} год.`);
    return { ok: true, value: text };
  }

  function parseCategory(raw) {
    const id = String(raw ?? '').trim();
    if (id === '') return fail('Выберите категорию.');
    if (!CATEGORY_BY_ID[id]) return fail('Неизвестная категория.');
    return { ok: true, value: id };
  }

  function parseDescription(raw) {
    const text = String(raw ?? '').trim();
    if (text.length > DESCRIPTION_MAX_LENGTH) {
      return fail(`Описание не длиннее ${DESCRIPTION_MAX_LENGTH} символов.`);
    }
    return { ok: true, value: text };
  }

  /**
   * Проверяет данные формы.
   * @returns {{ok: true, value: {amount, category, date, description}} | {ok: false, errors: Object<string,string>}}
   */
  function validateExpenseInput(input) {
    const source = input || {};
    const results = {
      amount: parseAmount(source.amount),
      category: parseCategory(source.category),
      date: parseDate(source.date),
      description: parseDescription(source.description),
    };
    const errors = Object.entries(results)
      .filter(([, r]) => !r.ok)
      .reduce((acc, [field, r]) => ({ ...acc, [field]: r.error }), {});
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: Object.fromEntries(Object.entries(results).map(([field, r]) => [field, r.value])),
    };
  }

  /** Проверка записи, прочитанной из хранилища (данным извне не доверяем). */
  function isValidStoredExpense(item) {
    return (
      item !== null &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      item.id.length > 0 &&
      Number.isSafeInteger(item.amount) &&
      item.amount > 0 &&
      item.amount <= MAX_AMOUNT_MINOR &&
      Boolean(CATEGORY_BY_ID[item.category]) &&
      isValidDateString(item.date) &&
      typeof item.description === 'string' &&
      item.description.length <= DESCRIPTION_MAX_LENGTH &&
      Number.isFinite(item.createdAt)
    );
  }

  function sanitizeStoredExpenses(data) {
    if (!Array.isArray(data)) return { expenses: [], dropped: 0 };
    const expenses = data.filter(isValidStoredExpense).map((e) => ({
      id: e.id,
      amount: e.amount,
      category: e.category,
      date: e.date,
      description: e.description,
      createdAt: e.createdAt,
    }));
    return { expenses, dropped: data.length - expenses.length };
  }

  function addExpense(expenses, expense) {
    return [...expenses, expense];
  }

  function removeExpense(expenses, id) {
    return expenses.filter((e) => e.id !== id);
  }

  function monthOf(date) {
    return date.slice(0, 7);
  }

  /** Записи выбранного месяца: новые даты сверху, при равной дате — последние добавленные сверху. */
  function expensesForMonth(expenses, month) {
    return expenses
      .filter((e) => monthOf(e.date) === month)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }

  /** Общий итог и суммы по категориям (по убыванию). Всё в тиынах. */
  function summarize(expenses) {
    const totals = expenses.reduce(
      (acc, e) => ({ ...acc, [e.category]: (acc[e.category] || 0) + e.amount }),
      {}
    );
    const byCategory = Object.entries(totals)
      .map(([id, amount]) => ({ ...CATEGORY_BY_ID[id], amount }))
      .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'ru'));
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    return { total, count: expenses.length, byCategory };
  }

  const numberFormat = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  function formatAmount(minor) {
    return `${numberFormat.format(minor / MINOR_PER_MAJOR)} ${CURRENCY}`;
  }

  return Object.freeze({
    CURRENCY,
    CATEGORIES,
    CATEGORY_BY_ID,
    DESCRIPTION_MAX_LENGTH,
    MAX_AMOUNT_MINOR,
    parseAmount,
    parseDate,
    validateExpenseInput,
    isValidMonthString,
    sanitizeStoredExpenses,
    addExpense,
    removeExpense,
    monthOf,
    expensesForMonth,
    summarize,
    formatAmount,
  });
});
