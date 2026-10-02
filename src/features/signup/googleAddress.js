let placesPromise;

// Load only when the visitor starts an address lookup, not on every page view.
export function loadGooglePlaces(apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY) {
  if (!apiKey) return Promise.reject(new Error("Address suggestions are not configured."));
  if (window.google?.maps?.importLibrary) return window.google.maps.importLibrary("places");
  if (!placesPromise) {
    placesPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const callback = "__myAipaAddressPlacesReady";
      const timer = window.setTimeout(() => finish(new Error("Address lookup timed out.")), 12000);
      function finish(error) {
        window.clearTimeout(timer);
        delete window[callback];
        script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else window.google.maps.importLibrary("places").then(resolve, reject);
      }
      window[callback] = () => finish();
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&v=weekly&libraries=places&callback=${callback}`;
      script.onerror = () => finish(new Error("Address lookup could not load."));
      document.head.appendChild(script);
    }).catch((error) => { placesPromise = undefined; throw error; });
  }
  return placesPromise;
}

export function canadianAddressFromPlace(place) {
  const components = place.addressComponents || [];
  const part = (type, short = false) => {
    const component = components.find((entry) => entry.types?.includes(type));
    return component?.[short ? "shortText" : "longText"] || "";
  };
  if (part("country", true).toUpperCase() !== "CA") throw new Error("Choose a Canadian address.");
  const number = part("street_number");
  const route = part("route");
  if (!number || !route) throw new Error("Enter the full street address manually.");
  const province = part("administrative_area_level_1", true).toUpperCase();
  if (!/^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/.test(province)) throw new Error("Confirm the province manually.");
  const unit = part("subpremise");
  const postal = part("postal_code").replace(/\s/g, "").toUpperCase();
  return {
    streetAddress: `${unit ? `${unit}-` : ""}${number} ${route}`,
    city: part("locality") || part("postal_town") || part("sublocality_level_1"),
    province,
    postalCode: postal.length === 6 ? `${postal.slice(0, 3)} ${postal.slice(3)}` : postal,
  };
}
