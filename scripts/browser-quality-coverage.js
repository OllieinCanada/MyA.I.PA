function coversCatalog(requested, required) {
  return Array.isArray(requested) && Array.isArray(required) && required.length > 0
    && new Set(required).size === required.length && new Set(requested).size === requested.length
    && requested.length === required.length && required.every(name => requested.includes(name));
}
module.exports = { coversCatalog };
