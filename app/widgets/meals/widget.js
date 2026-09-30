/**
 * Meal plan — the next seven dinners; tap a day to edit (synced, shared state "meals").
 */
OMD.defineWidget({
  id: 'meals',
  name: 'Meals',
  icon: 'utensils',
  group: 'Family',
  state: ['meals'],

  mount(ctx) {
    const { h, fmt } = ctx;
    const { ymd, addDays, startOfDay } = ctx.util;
    const mealStore = ctx.state('meals', () => {
      const m = {};
      ['Pasta night', 'Tacos', 'Veggie stir-fry', 'Chicken curry', 'Pizza Friday', 'BBQ', 'Roast dinner'].forEach((meal, i) => {
        m[ymd(addDays(new Date(), i))] = meal;
      });
      return m;
    });
    function loadMeals(m = mealStore.get()) {
      m ||= {};
      const cutoff = ymd(addDays(new Date(), -14));
      for (const k of Object.keys(m)) if (k < cutoff) delete m[k];
      return m;
    }

    const p = ctx.panel({ title: 'Meal plan', tint: 'amber', meta: 'This week' });
    const list = h('div', { class: 'meals scroll-y' });
    p.body.append(list);
    let editing = null;
    function render() {
      const meals = loadMeals();
      const today = startOfDay(new Date());
      list.replaceChildren(
        ...Array.from({ length: 7 }, (_, i) => {
          const d = addDays(today, i),
            key = ymd(d);
          const label = h('div', { class: 'meal-day' }, i === 0 ? 'Today' : fmt.weekdayShort.format(d));
          if (editing === key) {
            const input = h('input', {
              type: 'text',
              value: meals[key] || '',
              placeholder: 'What’s for dinner?',
              'aria-label': `Meal for ${fmt.weekday.format(d)}`,
            });
            const commit = () => {
              if (editing !== key) return;
              editing = null;
              const text = input.value.trim();
              mealStore.update((raw) => {
                const m = loadMeals(raw);
                if (text) m[key] = text;
                else delete m[key];
                return m;
              });
            };
            input.onkeydown = ctx.guard((e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                editing = null;
                render();
              }
            });
            input.onblur = ctx.guard(commit);
            ctx.setTimeout(() => input.focus(), 0);
            return h('div', { class: `meal${i === 0 ? ' is-today' : ''}`, role: 'button', tabindex: '0' }, label, input);
          }
          return h(
            'div',
            {
              class: `meal${i === 0 ? ' is-today' : ''}`,
              role: 'button',
              tabindex: '0',
              onclick: () => {
                editing = key;
                render();
              },
            },
            label,
            h('div', { class: `meal-name${meals[key] ? '' : ' is-empty'}` }, meals[key] || 'Tap to plan'),
          );
        }),
      );
    }
    mealStore.onChange(() => {
      if (!editing) render();
    });
    ctx.onTick((n) => {
      if (n.getHours() === 0 && n.getMinutes() === 0 && n.getSeconds() === 1) render();
    });
    p.onReload = render;
    render();
  },
});
