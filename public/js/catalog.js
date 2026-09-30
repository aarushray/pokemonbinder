// Binder catalogue shared by the browser pages and server.js: colours, binder types,
// each type's artwork aspect ratio, which colours it comes in, and its shape for the mockup.
(function (root) {
  // id: the value stored on designs and cart items (the hex code for plain colours).
  // texture: 'diamond' (default, raised diamond-plate) or 'felt' (velvet: mottled suede look).
  // depth: engraving depth in percent (higher = bolder artwork); colours without one use DEFAULT_DEPTH.
  const COLORS = [
    { id: '#e87a79', name: 'Pink', hex: '#e87a79' },
    { id: '#614875', name: 'Purple', hex: '#614875', depth: 300 },
    { id: '#445479', name: 'Navy Blue', hex: '#445479' },
    { id: '#fbcb46', name: 'Yellow', hex: '#fbcb46' },
    { id: '#395143', name: 'Green', hex: '#395143' },
    { id: '#b75901', name: 'Orange', hex: '#b75901' },
    { id: '#b82e40', name: 'Red', hex: '#b82e40' },
    { id: '#eeeeec', name: 'White', hex: '#eeeeec', depth: 700 },
    { id: '#2fb8ca', name: 'Turquoise', hex: '#2fb8ca', depth: 300 },
    // Grey keeps its original id (saved designs and carts use it); only the shade changed.
    { id: '#74716c', name: 'Grey', hex: '#969696', texture: 'felt', depth: 300 },
  ];
  // Every other colour, including custom colours from the colour wheel.
  const DEFAULT_DEPTH = 600;
  // Diamond (woven) colours are the plain ones; velvet colours use the felt texture.
  const DIAMOND = COLORS.filter((c) => !c.texture).map((c) => c.id);
  const VELVET = COLORS.filter((c) => c.texture === 'felt').map((c) => c.id);

  // ratio: artwork width:height (the engraved cover has exactly this shape).
  // basePrice: starting price of a custom design on this binder, shown on the Custom Designs page.
  // capacity: how many pockets a custom design on this binder holds (a texture's `cards` overrides it).
  // colors: colour ids from COLORS this type is sold in (first one is the default).
  // finishes (optional): texture choices shown as a dropdown, each limited to some of the colours.
  // A finish with `cards` always holds that many cards, overriding the design's own capacity.
  // `extraPrice` is added to the binder's base price on the Custom Designs page.
  // shape: mockup geometry relative to a 1000px-wide cover. `height` (optional) scales the cover's
  // height from the art ratio; the art is then cropped top and bottom to fit. `display` (optional)
  // draws the binder that much smaller than the 9-pocket, centred in a 9-pocket-sized picture.
  const TYPES = [
    { id: '4-pocket', name: '4-slots', pockets: 4, capacity: 160, basePrice: 60, ratio: [2, 3], colors: DIAMOND,
      shape: { spine: 44, radius: 80, tab: false, display: 0.68 } },
    { id: '4-pocket-toploader', name: '4-slots toploader', pockets: 4, capacity: 112, basePrice: 80, ratio: [2, 3], colors: DIAMOND,
      shape: { spine: 50, radius: 80, tab: false, display: 0.88 } },
    { id: '9-pocket', name: '9-slots', pockets: 9, capacity: 360, basePrice: 80, ratio: [2, 3], colors: [...DIAMOND, ...VELVET],
      finishes: [
        { id: 'diamond', name: 'Diamond texture', colors: DIAMOND },
        { id: 'velvet', name: 'Velvet texture', colors: VELVET, cards: 540, extraPrice: 5 },
      ],
      shape: { spine: 36, radius: 72, tab: false } },
    { id: '9-pocket-toploader', name: '9-slots toploader', pockets: 9, capacity: 252, basePrice: 100, ratio: [4, 5], colors: DIAMOND,
      shape: { spine: 60, radius: 72, tab: false } },
    { id: '12-pocket', name: '12-slots', pockets: 12, capacity: 480, basePrice: 90, ratio: [4, 5], colors: DIAMOND,
      shape: { spine: 75, radius: 60, tab: false } },
  ];
  const DEFAULT_TYPE = '9-pocket';

  // The shop's pages (Pokémon, One Piece, ...) are managed on the admin page and stored with the
  // designs in designs/designs.json, not here.
  const catalog = { COLORS, DEFAULT_DEPTH, TYPES, DEFAULT_TYPE };
  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
  else root.Catalog = catalog;
})(this);
