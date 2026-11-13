// Functions passed to page.evaluate must be self-contained.
function captureFocusSurfaces(activeOnly = false) {
  const key = element => { const parts = []; for (let node = element; node?.parentElement; node = node.parentElement)
    parts.unshift(Array.prototype.indexOf.call(node.parentElement.children, node)); return parts.join('.'); };
  const nodes = new Set();
  const controls = activeOnly ? [document.activeElement]
    : document.querySelectorAll('a,button,input,select,textarea,summary,[tabindex]');
  for (const control of controls) { let node = control;
    for (let depth = 0; node && depth < 4 && !['BODY', 'HTML'].includes(node.tagName); depth++, node = node.parentElement) nodes.add(node); }
  return { active: { tag: document.activeElement?.tagName, tabIndex: document.activeElement?.tabIndex,
    html: document.activeElement?.outerHTML?.slice(0, 800) },
    surfaces: [...nodes].map(element => { const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { key: key(element), tag: element.tagName, className: String(element.className || ''),
        focusWithin: element.matches(':focus-within'), visible: style.display !== 'none' && style.visibility === 'visible'
          && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0,
        outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
        borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => ({ width: style[`border${side}Width`],
          style: style[`border${side}Style`], color: style[`border${side}Color`] })) };
    }) };
}
function visibleInk(value) {
  return Boolean(value && value !== 'none' && !/transparent|rgba\([^)]*,\s*0(?:\.0+)?\s*\)|\/\s*0(?:\.0+)?%?\s*\)/i.test(value));
}
function assessKeyboardFocus(before, after) {
  if (!after?.active || ['', 'BODY', 'HTML'].includes(after.active.tag || '') || after.active.tabIndex < 0)
    return { passed: false, reason: 'no_keyboard_reachable_control' };
  for (const surface of after.surfaces || []) {
    const prior = before.surfaces?.find(row => row.key === surface.key);
    if (!prior || !surface.focusWithin || !surface.visible) continue;
    const outline = row => [row.outlineStyle, row.outlineWidth, row.outlineColor].join('|');
    if (!['none', 'hidden', ''].includes(surface.outlineStyle) && parseFloat(surface.outlineWidth) > 0
      && visibleInk(surface.outlineColor) && outline(surface) !== outline(prior))
      return { passed: true, reason: 'changed_outline', surface: surface.key };
    const layers = value => String(value || '').split(/,(?![^(]*\))/).map(x => x.trim());
    if (layers(surface.boxShadow).some(layer => visibleInk(layer) && !layers(prior.boxShadow).includes(layer)))
      return { passed: true, reason: 'changed_shadow', surface: surface.key };
    if (surface.borders?.some((border, index) => parseFloat(border.width) > 0 && !['none', 'hidden'].includes(border.style)
      && visibleInk(border.color) && JSON.stringify(border) !== JSON.stringify(prior.borders?.[index])))
      return { passed: true, reason: 'changed_border', surface: surface.key };
  }
  return { passed: false, reason: 'no_visible_focus_change' };
}
module.exports = { captureFocusSurfaces, assessKeyboardFocus };
