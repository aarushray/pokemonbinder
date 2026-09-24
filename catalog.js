// Binder catalogue shared by the browser pages and server.js: colours, binder types,
// each type's artwork aspect ratio, which colours it comes in, and its shape for the mockup.
(function (root) {
  const COLORS = [
    { name: 'Pink', hex: '#e87a79' },
    { name: 'Purple', hex: '#614875' },
    { name: 'Navy Blue', hex: '#445479' },
    { name: 'Yellow', hex: '#fbcb46' },
    { name: 'Green', hex: '#395143' },
    { name: 'Orange', hex: '#b75901' },
    { name: 'Red', hex: '#b82e40' },
    { name: 'White', hex: '#eeeeec' },
  ];
  const ALL = COLORS.map((c) => c.hex);

  // ratio: artwork width:height (the engraved cover has exactly this shape).
  // colors: hex codes from COLORS this type is sold in (first one is the default).
  // shape: mockup geometry relative to a 1000px-wide cover. `height` (optional) scales the cover's
  // height from the art ratio; the art is then cropped top and bottom to fit. `display` (optional)
  // draws the binder that much smaller than the 9-pocket, centred in a 9-pocket-sized picture.
  const TYPES = [
    { id: '4-pocket', name: '4-pocket', pockets: 4, ratio: [2, 3], colors: ALL,
      shape: { spine: 44, radius: 80, tab: true, display: 0.68 } },
    { id: '4-pocket-toploader', name: '4-pocket toploader', pockets: 4, ratio: [2, 3], colors: ALL,
      shape: { spine: 50, radius: 80, tab: true, display: 0.88 } },
    { id: '9-pocket', name: '9-pocket', pockets: 9, ratio: [2, 3], colors: ALL,
      shape: { spine: 36, radius: 72, tab: true } },
    { id: '9-pocket-toploader', name: '9-pocket toploader', pockets: 9, ratio: [4, 5], colors: ALL,
      shape: { spine: 60, radius: 72, tab: false } },
    { id: '12-pocket', name: '12-pocket', pockets: 12, ratio: [4, 5], colors: ALL,
      shape: { spine: 75, radius: 60, tab: false } },
  ];
  const DEFAULT_TYPE = '9-pocket';

  const catalog = { COLORS, TYPES, DEFAULT_TYPE };
  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
  else root.Catalog = catalog;
})(this);
