/**
 * Quote of the day — your own quotes, or a built-in one; changes at midnight.
 */
const BUILTIN_QUOTES = [
  ['The best way to predict the future is to invent it.', 'Alan Kay'],
  ['Simplicity is prerequisite for reliability.', 'Edsger W. Dijkstra'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['The only way to do great work is to love what you do.', 'Steve Jobs'],
  ['Nothing in life is to be feared, it is only to be understood.', 'Marie Curie'],
  ['Imagination is more important than knowledge.', 'Albert Einstein'],
  ['The journey of a thousand miles begins with a single step.', 'Lao Tzu'],
  ['Stay hungry. Stay foolish.', 'The Whole Earth Catalog'],
  ['Life is what happens while you’re busy making other plans.', 'John Lennon'],
  ['The unexamined life is not worth living.', 'Socrates'],
  ['Do. Or do not. There is no try.', 'Yoda'],
  ['We are what we repeatedly do. Excellence, then, is not an act, but a habit.', 'Will Durant'],
  ['Not all those who wander are lost.', 'J. R. R. Tolkien'],
  ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
  ['“Hope” is the thing with feathers that perches in the soul.', 'Emily Dickinson'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['Make it work, make it right, make it fast.', 'Kent Beck'],
  ['If you want to go fast, go alone. If you want to go far, go together.', 'African proverb'],
  ['The mind is not a vessel to be filled, but a fire to be kindled.', 'Plutarch'],
  ['Home is where one starts from.', 'T. S. Eliot'],
  ['It does not matter how slowly you go as long as you do not stop.', 'Confucius'],
  ['The best time to plant a tree was twenty years ago. The second best time is now.', 'Proverb'],
  ['Act as if what you do makes a difference. It does.', 'William James'],
];

OMD.defineWidget({
  id: 'quote',
  name: 'Quote',
  icon: 'quote',
  group: 'Family',
  settings: [['QUOTES', 'Custom quotes', 'textarea', { help: '<code>Quote text | Author</code>. Empty = built-in quote of the day.' }]],
  defaults: {
    QUOTES: [], // "Quote text | Author". Empty → built-in quote of the day.
  },

  mount(ctx) {
    const { h } = ctx;
    const { pipe, hash, ymd } = ctx.util;
    const p = ctx.panel({ title: 'Quote of the day', tint: 'violet', actions: ['expand'] });
    const box = h('div', { class: 'quote' });
    p.body.append(box);
    const quotes = ctx.settings.QUOTES.length ? ctx.settings.QUOTES.map(pipe) : BUILTIN_QUOTES;
    function render() {
      const [text, author] = quotes[hash(ymd(new Date())) % quotes.length];
      box.replaceChildren(h('blockquote', null, text), author ? h('cite', null, `— ${author}`) : '');
    }
    ctx.onTick((n) => {
      if (n.getHours() === 0 && n.getMinutes() === 0 && n.getSeconds() === 3) render();
    });
    render();
  },
});
