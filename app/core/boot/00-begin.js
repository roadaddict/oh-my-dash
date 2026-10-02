/* ==========================================================================
   BEGIN — when a saved snapshot is on screen (app/core/snapshot.js), let the
   browser paint it before the dashboard starts its own work.
   ========================================================================== */
if (document.documentElement.classList.contains('from-snapshot'))
  await new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 100); // hidden tabs get no frames
  });
