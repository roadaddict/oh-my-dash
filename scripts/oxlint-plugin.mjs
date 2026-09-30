/**
 * Local oxlint rules (loaded through "jsPlugins" in .oxlintrc.json) for what a widget must
 * do through ctx rather than on the page directly.
 */
const rule = (message, check) => ({ meta: { type: 'problem' }, create: (context) => check((node) => context.report({ node, message })) });

export default {
  meta: { name: 'omd' },
  rules: {
    /** el.addEventListener(…) → ctx.listen(el, …) or an on… attribute of ctx.h. */
    'no-raw-listeners': rule('Use ctx.listen(target, type, fn) or an on… attribute of ctx.h — removed with the widget, errors stay inside it.', (report) => ({
      CallExpression(node) {
        if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'addEventListener') report(node);
      },
    })),
    /** A widget only touches its own panel. */
    'no-page-access': rule('A widget only touches its own panel (ctx.panel), or ctx.ui.dialog for overlays.', (report) => ({
      MemberExpression(node) {
        if (node.object.type === 'Identifier' && node.object.name === 'document' && ['cookie', 'body', 'head', 'documentElement'].includes(node.property.name))
          report(node);
      },
    })),
  },
};
