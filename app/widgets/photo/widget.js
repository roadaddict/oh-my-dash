/**
 * Photo slideshow — the core slideshow on a panel. The photo settings are the
 * dashboard's own (photo screens and the photo background use them too); this
 * widget shows them in its settings section.
 */
OMD.defineWidget({
  id: 'photo',
  name: 'Photo slideshow',
  icon: 'image',
  group: 'Photos, music & news',
  settings: [
    ['PHOTO_URLS', 'Photo URLs', 'textarea', { help: 'One per line, optional caption: <code>https://…/1.jpg | Summer 2025</code>' }],
    ['PHOTO_FEEDS', 'Photo feeds (RSS / Atom / Flickr)', 'textarea'],
    ['GOOGLE_PHOTOS_ALBUM', 'Google Photos shared album link', 'url', { help: 'Unofficial, needs CORS_PROXY. Leave all empty for scenic demo photos.' }],
    [
      ['PHOTO_INTERVAL_SEC', 'Change every (s)', 'number', { min: 5 }],
      [
        'PHOTO_FIT',
        'Fit',
        'select',
        {
          options: [
            ['cover', 'Fill screen'],
            ['contain', 'Whole photo'],
          ],
        },
      ],
    ],
    ['PHOTO_KEN_BURNS', 'Ken Burns pan & zoom', 'checkbox'],
    ['PHOTO_SHUFFLE', 'Shuffle', 'checkbox'],
  ],

  mount(ctx) {
    const p = ctx.panel({ title: 'Photos', head: false });
    p.el.style.padding = '0';
    ctx.ui.slideshow(p.body);
  },
});
