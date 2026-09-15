/*
 * Хранилище расходов в localStorage браузера.
 * Любые проблемы (приватный режим, переполнение, повреждённый JSON) не ломают
 * приложение, а возвращаются как понятная ошибка для показа пользователю.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'student-expenses:v1';
  const { sanitizeStoredExpenses } = root.ExpenseLogic;

  function load() {
    let raw;
    try {
      raw = root.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      console.error('localStorage недоступен', err);
      return { expenses: [], error: 'Браузер запрещает сохранение данных (возможно, приватный режим). Записи пропадут после обновления страницы.' };
    }
    if (raw === null) return { expenses: [], error: null };

    try {
      const { expenses, dropped } = sanitizeStoredExpenses(JSON.parse(raw));
      const error = dropped > 0 ? `Пропущено повреждённых записей: ${dropped}.` : null;
      return { expenses, error };
    } catch (err) {
      console.error('Не удалось разобрать сохранённые данные', err);
      return { expenses: [], error: 'Сохранённые данные повреждены и не могут быть прочитаны. Новые записи сохранятся заново.' };
    }
  }

  function save(expenses) {
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
      return { ok: true };
    } catch (err) {
      console.error('Не удалось сохранить данные', err);
      return { ok: false, error: 'Не удалось сохранить изменения в браузере. Они пропадут после обновления страницы.' };
    }
  }

  root.ExpenseStorage = Object.freeze({ STORAGE_KEY, load, save });
})(window);
