import React, { useEffect, useId, useRef, useState } from "react";
import { canadianAddressFromPlace, loadGooglePlaces } from "../features/signup/googleAddress";
import "./AddressAutocomplete.css";

export default function AddressAutocomplete({ value, onChange, onSelect, onBlur, renderInput, className = "", apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY, loadPlaces = loadGooglePlaces }) {
  const id = useId().replace(/:/g, "");
  const [suggestions, setSuggestions] = useState([]);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const session = useRef(null);
  const selected = useRef("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  useEffect(() => {
    const current = ++generation.current;
    setSuggestions([]);
    setActive(-1);
    setBusy(false);
    if (!apiKey || !focused || value.trim().length < 3 || value === selected.current) return undefined;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const library = await loadPlaces(apiKey);
        if (current !== generation.current) return;
        if (!session.current) session.current = new library.AutocompleteSessionToken();
        const result = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: value, includedRegionCodes: ["ca"], region: "ca", language: "en-CA",
          includedPrimaryTypes: ["street_address", "premise", "subpremise"], sessionToken: session.current,
        });
        if (current !== generation.current) return;
        const predictions = result.suggestions.map((item) => item.placePrediction).filter(Boolean).slice(0, 5);
        setSuggestions(predictions);
        setMessage(predictions.length ? "Choose your address to fill the remaining fields." : "No matches. You can enter the address manually.");
      } catch (_) {
        if (current === generation.current) setMessage("Address suggestions are unavailable. Enter your address manually.");
      } finally { if (current === generation.current) setBusy(false); }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [apiKey, focused, loadPlaces, value]);

  async function select(prediction) {
    const current = ++generation.current;
    setBusy(true);
    setSuggestions([]);
    try {
      const place = prediction.toPlace();
      // Only request address components, not maps, photos or business details.
      await place.fetchFields({ fields: ["addressComponents"] });
      if (!mounted.current || current !== generation.current) return;
      const address = canadianAddressFromPlace(place);
      selected.current = address.streetAddress;
      onSelect(address);
      setMessage("Address filled. Check it and add a unit number if needed.");
    } catch (_) {
      if (mounted.current && current === generation.current) setMessage("Could not fill this address. Enter the remaining fields manually.");
    } finally {
      session.current = null;
      if (mounted.current && current === generation.current) setBusy(false);
    }
  }
  const open = focused && suggestions.length > 0;
  return <div className={`signup-address-autocomplete ${className}`}>
    {renderInput({
      role: apiKey ? "combobox" : undefined, "aria-autocomplete": apiKey ? "list" : undefined,
      "aria-expanded": apiKey ? open : undefined, "aria-controls": open ? `${id}-list` : undefined,
      "aria-activedescendant": open && active >= 0 ? `${id}-option-${active}` : undefined,
      "aria-busy": busy, "aria-describedby": `${id}-hint`,
      onFocus: () => setFocused(true),
      onChange: (event) => { generation.current += 1; selected.current = ""; setMessage(""); onChange(event); },
      onBlur: (event) => { setFocused(false); onBlur?.(event); },
      onKeyDown: (event) => {
        if (event.key === "Escape") { generation.current += 1; setSuggestions([]); setActive(-1); setBusy(false); }
        if (!open) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setActive((index) => index < 0 ? (event.key === "ArrowDown" ? 0 : suggestions.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
        } else if (event.key === "Enter") {
          event.preventDefault(); if (active >= 0) select(suggestions[active]);
        }
      },
    })}
    {open ? <div className="signup-address-results">
      <ul id={`${id}-list`} role="listbox" aria-label="Canadian address suggestions">
        {suggestions.map((prediction, index) => <li key={prediction.placeId || index} id={`${id}-option-${index}`} role="option" aria-selected={index === active}
          className={index === active ? "is-active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => select(prediction)}>
          {prediction.text.toString()}
        </li>)}
      </ul>
      <span className="signup-address-attribution" translate="no">Google Maps</span>
    </div> : null}
    <p id={`${id}-hint`} className="signup-address-hint" role="status" aria-live="polite">
      {busy ? "Looking up address…" : message || (apiKey ? "Start typing, then choose your address. Manual entry is always available." : "Enter your street address, city, province and postal code.")}
    </p>
  </div>;
}
