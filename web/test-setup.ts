// jsdom has no layout, so scrolling into view is a no-op in tests.
Element.prototype.scrollIntoView = () => {};
