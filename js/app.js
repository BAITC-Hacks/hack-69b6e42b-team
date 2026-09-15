/*
 * UI: связывает форму, список и итоги с логикой (logic.js) и хранилищем (storage.js).
 * Состояние неизменяемое: каждое действие создаёт новый объект state и перерисовывает экран.
 * Пользовательский текст выводится только через textContent (защита от XSS).
 */
(function () {
  'use strict';

  const L = window.ExpenseLogic;
  const Storage = window.ExpenseStorage;
  const UNDO_TIMEOUT_MS = 6000;
  const FIELDS = ['amount', 'category', 'date', 'description'];

  const $ = (id) => document.getElementById(id);
  const el = {
    form: $('expense-form'),
    month: $('month'),
    prevMonth: $('prev-month'),
    nextMonth: $('next-month'),
    category: $('category'),
    date: $('date'),
    amount: $('amount'),
    formStatus: $('form-status'),
    storageWarning: $('storage-warning'),
    summaryMonth: $('summary-month'),
    summaryTotal: $('summary-total'),
    summaryMeta: $('summary-meta'),
    summaryBar: $('summary-bar'),
    summaryCheck: $('summary-check'),
    categoryList: $('category-list'),
    categoryEmpty: $('category-empty'),
    expenseList: $('expense-list'),
    listEmpty: $('list-empty'),
    listCount: $('list-count'),
    toast: $('toast'),
    toastText: $('toast-text'),
    toastUndo: $('toast-undo'),
  };

  const monthTitle = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
  const dayTitle = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' });

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function todayString() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function shiftMonth(month, delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const next = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    return L.isValidMonthString(next) ? next : month;
  }

  function parseLocalDate(dateString) {
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatMonth(month) {
    return monthTitle.format(parseLocalDate(`${month}-01`)).replace(/\s*г\.$/, '');
  }

  function pluralRecords(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} запись`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} записи`;
    return `${n} записей`;
  }

  function pluralCategories(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} категория`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} категории`;
    return `${n} категорий`;
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // ---------- состояние ----------

  const loaded = Storage.load();
  let state = {
    expenses: loaded.expenses,
    month: todayString().slice(0, 7),
    warning: loaded.error,
    undo: null, // { expense, timer }
  };

  function setState(patch) {
    state = { ...state, ...patch };
    render();
  }

  function commitExpenses(expenses, extraPatch) {
    const result = Storage.save(expenses);
    setState({ ...extraPatch, expenses, warning: result.ok ? null : result.error });
  }

  // ---------- рендер ----------

  function render() {
    const monthExpenses = L.expensesForMonth(state.expenses, state.month);
    const summary = L.summarize(monthExpenses);

    if (el.month.value !== state.month) el.month.value = state.month;
    el.storageWarning.hidden = !state.warning;
    el.storageWarning.textContent = state.warning || '';

    renderSummary(summary);
    renderList(monthExpenses);
  }

  function renderSummary(summary) {
    el.summaryMonth.textContent = formatMonth(state.month);
    el.summaryTotal.textContent = L.formatAmount(summary.total);
    el.summaryMeta.textContent = summary.count > 0
      ? `${pluralRecords(summary.count)} · ${pluralCategories(summary.byCategory.length)}`
      : 'Нет записей';

    el.summaryBar.replaceChildren(
      ...summary.byCategory.map((c) => {
        const seg = document.createElement('span');
        seg.style.flexGrow = String(c.amount);
        seg.style.background = c.color;
        return seg;
      })
    );
    el.summaryBar.hidden = summary.count === 0;

    el.categoryList.replaceChildren(...summary.byCategory.map((c) => categoryRow(c, summary.total)));
    el.categoryEmpty.hidden = summary.count > 0;

    const categoriesSum = summary.byCategory.reduce((acc, c) => acc + c.amount, 0);
    el.summaryCheck.hidden = summary.count === 0;
    el.summaryCheck.textContent = categoriesSum === summary.total
      ? `✓ Сумма категорий = итог (${L.formatAmount(categoriesSum)})`
      : `⚠ Расхождение: категории ${L.formatAmount(categoriesSum)}, итог ${L.formatAmount(summary.total)}`;
  }

  function categoryRow(c, total) {
    const ratio = total > 0 ? c.amount / total : 0;
    const li = document.createElement('li');
    li.className = 'cat-row';
    li.dataset.category = c.id;
    li.style.setProperty('--cat', c.color);
    li.style.setProperty('--share', `${ratio * 100}%`);

    const name = document.createElement('span');
    name.className = 'cat-name';
    name.textContent = c.label;

    const pct = document.createElement('span');
    pct.className = 'cat-share';
    pct.textContent = `${Math.round(ratio * 100)}%`;

    const amount = document.createElement('span');
    amount.className = 'cat-amount';
    amount.textContent = L.formatAmount(c.amount);

    li.append(name, pct, amount);
    return li;
  }

  function renderList(monthExpenses) {
    el.listCount.textContent = String(monthExpenses.length);
    el.listEmpty.hidden = monthExpenses.length > 0;
    el.expenseList.replaceChildren(...monthExpenses.map(expenseRow));
  }

  function expenseRow(e) {
    const category = L.CATEGORY_BY_ID[e.category];
    const li = document.createElement('li');
    li.className = 'expense';
    li.dataset.id = e.id;
    li.style.setProperty('--cat', category.color);

    const main = document.createElement('div');
    main.className = 'expense-main';

    const title = document.createElement('span');
    title.className = 'expense-cat';
    title.textContent = category.label;

    const meta = document.createElement('span');
    meta.className = 'expense-meta';
    meta.textContent = dayTitle.format(parseLocalDate(e.date));
    main.append(title, meta);

    if (e.description) {
      const desc = document.createElement('span');
      desc.className = 'expense-desc';
      desc.textContent = e.description;
      main.append(desc);
    }

    const amount = document.createElement('span');
    amount.className = 'expense-amount';
    amount.textContent = L.formatAmount(e.amount);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete-btn';
    del.dataset.action = 'delete';
    del.setAttribute('aria-label', `Удалить: ${category.label}, ${L.formatAmount(e.amount)}`);
    del.textContent = '✕';

    li.append(main, amount, del);
    return li;
  }

  // ---------- форма ----------

  function showFieldErrors(errors) {
    FIELDS.forEach((field) => {
      const input = el.form.elements[field];
      const message = errors[field] || '';
      $(`${field}-error`).textContent = message;
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    });
  }

  function flashStatus(text, kind) {
    el.formStatus.textContent = text;
    el.formStatus.dataset.kind = kind;
  }

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(el.form);
    const result = L.validateExpenseInput(Object.fromEntries(formData.entries()));

    if (!result.ok) {
      showFieldErrors(result.errors);
      flashStatus('Проверьте поля, отмеченные красным.', 'error');
      const firstInvalid = FIELDS.find((f) => result.errors[f]);
      el.form.elements[firstInvalid].focus();
      return;
    }

    showFieldErrors({});
    const expense = { id: newId(), ...result.value, createdAt: Date.now() };
    const targetMonth = L.monthOf(expense.date);
    const switched = targetMonth !== state.month;

    commitExpenses(L.addExpense(state.expenses, expense), { month: targetMonth });

    flashStatus(
      switched
        ? `Добавлено ${L.formatAmount(expense.amount)}. Показан месяц: ${formatMonth(targetMonth)}.`
        : `Добавлено: ${L.CATEGORY_BY_ID[expense.category].label}, ${L.formatAmount(expense.amount)}.`,
      'ok'
    );

    // Сбрасываем только сумму и описание: категория и дата часто повторяются.
    el.form.elements.amount.value = '';
    el.form.elements.description.value = '';
    el.amount.focus();
  }

  function clearFieldErrorOnInput(event) {
    const field = event.target.name;
    if (!FIELDS.includes(field)) return;
    $(`${field}-error`).textContent = '';
    event.target.setAttribute('aria-invalid', 'false');
  }

  // ---------- удаление с отменой ----------

  function hideToast() {
    if (state.undo) clearTimeout(state.undo.timer);
    el.toast.hidden = true;
    state = { ...state, undo: null };
  }

  function handleListClick(event) {
    const button = event.target.closest('[data-action="delete"]');
    if (!button) return;
    const id = button.closest('.expense').dataset.id;
    const expense = state.expenses.find((e) => e.id === id);
    if (!expense) return;

    hideToast();
    commitExpenses(L.removeExpense(state.expenses, id));

    el.toastText.textContent = `Удалено: ${L.CATEGORY_BY_ID[expense.category].label}, ${L.formatAmount(expense.amount)}`;
    el.toast.hidden = false;
    const timer = setTimeout(hideToast, UNDO_TIMEOUT_MS);
    state = { ...state, undo: { expense, timer } };
    flashStatus('', 'ok');
  }

  function handleUndo() {
    if (!state.undo) return;
    const { expense } = state.undo;
    hideToast();
    const alreadyThere = state.expenses.some((e) => e.id === expense.id);
    if (!alreadyThere) {
      commitExpenses(L.addExpense(state.expenses, expense), { month: L.monthOf(expense.date) });
    }
  }

  // ---------- месяц ----------

  function handleMonthChange() {
    const value = el.month.value;
    if (L.isValidMonthString(value)) {
      setState({ month: value });
    } else {
      el.month.value = state.month; // пустое/неверное значение — возвращаем текущий месяц
    }
  }

  // ---------- синхронизация между вкладками ----------

  function handleStorageEvent(event) {
    if (event.key !== Storage.STORAGE_KEY) return;
    const fresh = Storage.load();
    setState({ expenses: fresh.expenses, warning: fresh.error });
  }

  // ---------- init ----------

  function init() {
    el.category.append(
      ...L.CATEGORIES.map((c) => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = c.label;
        return option;
      })
    );
    el.date.value = todayString();

    el.form.addEventListener('submit', handleSubmit);
    el.form.addEventListener('input', clearFieldErrorOnInput);
    el.form.addEventListener('change', clearFieldErrorOnInput);
    el.month.addEventListener('change', handleMonthChange);
    el.prevMonth.addEventListener('click', () => setState({ month: shiftMonth(state.month, -1) }));
    el.nextMonth.addEventListener('click', () => setState({ month: shiftMonth(state.month, 1) }));
    el.expenseList.addEventListener('click', handleListClick);
    el.toastUndo.addEventListener('click', handleUndo);
    window.addEventListener('storage', handleStorageEvent);

    render();
  }

  init();
})();
