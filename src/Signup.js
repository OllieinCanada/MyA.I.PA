import React, { useEffect, useMemo, useRef, useState } from "react";

let googlePlacesLoaderPromise = null;

function loadGooglePlaces(apiKey) {
  if (typeof window === "undefined") return Promise.reject(new Error("Window unavailable"));
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (!apiKey) return Promise.reject(new Error("Missing Google Maps API key"));
  if (googlePlacesLoaderPromise) return googlePlacesLoaderPromise;

  googlePlacesLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("google-maps-places-script");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google));
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Maps script")));
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-places-script";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`;
    script.onload = () => {
      if (window.google?.maps?.places) resolve(window.google);
      else reject(new Error("Google Places library unavailable"));
    };
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });

  return googlePlacesLoaderPromise;
}

const IconPhone = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.86.3 1.7.54 2.5a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.58-1.06a2 2 0 0 1 2.11-.45c.8.24 1.64.42 2.5.54A2 2 0 0 1 22 16.92Z" />
  </svg>
);

const IconSearch = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const IconSpark = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    <path d="m6.5 6.5 3 3M14.5 14.5l3 3M17.5 6.5l-3 3M9.5 14.5l-3 3" />
  </svg>
);

function CountryToggle({ country, setCountry }) {
  const options = [
    { code: "us", label: "United States", emoji: "🇺🇸" },
    { code: "ca", label: "Canada", emoji: "🇨🇦" },
  ];

  return (
    <div className="inline-flex rounded-full bg-white/75 p-1 text-sm font-bold text-slate-700 ring-1 ring-white/70 shadow-[0_14px_28px_-18px_rgba(15,23,42,0.45)]">
      {options.map((opt) => (
        <button
          key={opt.code}
          type="button"
          onClick={() => setCountry(opt.code)}
          className={
            "rounded-full px-4 py-2 transition " +
            (country === opt.code
              ? "bg-[#0f7d5f] text-white shadow-[0_10px_20px_-12px_rgba(15,118,110,0.8)]"
              : "hover:bg-white/80")
          }
        >
          <span className="mr-2">{opt.emoji}</span>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function Signup() {
  const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || "";
  const [country, setCountry] = useState("us");
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [isLoadingPredictions, setIsLoadingPredictions] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [showPredictions, setShowPredictions] = useState(false);
  const [showManualDetails, setShowManualDetails] = useState(false);
  const [manualDetails, setManualDetails] = useState({
    businessName: "",
    phone: "",
    address: "",
    website: "",
    hours: "",
    services: "",
  });

  const autocompleteServiceRef = useRef(null);
  const placesServiceRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    loadGooglePlaces(apiKey)
      .then((googleObj) => {
        if (!mounted) return;
        autocompleteServiceRef.current = new googleObj.maps.places.AutocompleteService();
        placesServiceRef.current = new googleObj.maps.places.PlacesService(document.createElement("div"));
        sessionTokenRef.current = new googleObj.maps.places.AutocompleteSessionToken();
        setMapsError("");
        setMapsReady(true);
      })
      .catch((err) => {
        if (!mounted) return;
        setMapsReady(false);
        setMapsError(err?.message || "Google Places failed to load");
      });

    return () => {
      mounted = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [apiKey]);

  useEffect(() => {
    setPredictions([]);
    setSelectedPlace(null);
    setSearchError("");
  }, [country]);

  useEffect(() => {
    if (!mapsReady || !autocompleteServiceRef.current) return;

    const trimmed = query.trim();
    if (!trimmed) {
      setPredictions([]);
      setIsLoadingPredictions(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsLoadingPredictions(true);

    debounceRef.current = setTimeout(() => {
      const googleObj = window.google;
      if (!googleObj?.maps?.places) {
        setIsLoadingPredictions(false);
        return;
      }

      autocompleteServiceRef.current.getPlacePredictions(
        {
          input: trimmed,
          types: ["establishment"],
          componentRestrictions: { country },
          sessionToken: sessionTokenRef.current,
        },
        (results, status) => {
          setIsLoadingPredictions(false);
          if (status === googleObj.maps.places.PlacesServiceStatus.OK && Array.isArray(results)) {
            setPredictions(results.slice(0, 6));
            setSearchError("");
            return;
          }
          setPredictions([]);
          if (status && status !== googleObj.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            setSearchError("Could not fetch Google business results right now.");
          }
        }
      );
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, country, mapsReady]);

  const selectedSummary = useMemo(() => {
    if (!selectedPlace) return null;
    const pieces = [];
    if (selectedPlace.name) pieces.push(selectedPlace.name);
    if (selectedPlace.formatted_address) pieces.push(selectedPlace.formatted_address);
    return pieces.join(" • ");
  }, [selectedPlace]);

  const canContinue = Boolean(
    selectedPlace ||
      manualDetails.businessName.trim() ||
      manualDetails.phone.trim() ||
      manualDetails.address.trim()
  );

  const handleSelectPrediction = (prediction) => {
    if (!prediction?.place_id) return;
    if (!placesServiceRef.current || !window.google?.maps?.places) {
      setSearchError("Google Places is not ready yet.");
      return;
    }

    setIsLoadingDetails(true);
    setSearchError("");

    placesServiceRef.current.getDetails(
      {
        placeId: prediction.place_id,
        sessionToken: sessionTokenRef.current,
        fields: [
          "place_id",
          "name",
          "formatted_address",
          "website",
          "formatted_phone_number",
          "business_status",
          "rating",
          "user_ratings_total",
          "url",
          "geometry",
        ],
      },
      (place, status) => {
        setIsLoadingDetails(false);
        if (status === window.google.maps.places.PlacesServiceStatus.OK && place) {
          setSelectedPlace(place);
          setQuery(prediction.description);
          setPredictions([]);
          setShowPredictions(false);
          sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
          return;
        }
        setSearchError("Could not load that business. Try another result.");
      }
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSearchError("");

    if (!mapsReady) {
      const q = query.trim();
      if (!q) return;
      window.open(`https://www.google.com/search?q=${encodeURIComponent(q + " business")}`, "_blank", "noopener,noreferrer");
      return;
    }

    if (predictions[0]) {
      handleSelectPrediction(predictions[0]);
      return;
    }

    if (!query.trim()) {
      setSearchError("Enter your business name to search.");
      return;
    }

    setSearchError("No matching business found yet. Try a different name or city.");
  };

  const handleManualDetailChange = (field) => (e) => {
    const value = e.target.value;
    setManualDetails((prev) => ({ ...prev, [field]: value }));
  };

  const goHome = () => {
    window.location.hash = "/";
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#c9b268] text-white">
      <div className="relative min-h-screen">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_12%_12%,rgba(255,245,210,0.28),transparent_60%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_520px_at_62%_55%,rgba(20,18,13,0.18),transparent_68%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(0,0,0,0.08))]" />

        <header className="relative z-20 border-b border-white/35 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-4">
            <button type="button" onClick={goHome} className="flex items-center gap-3 text-left">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#224e51] text-white shadow-[0_12px_24px_-18px_rgba(15,23,42,0.8)]">
                <IconPhone />
              </span>
              <span>
                <span className="block text-2xl font-serif font-semibold leading-none text-slate-900">My AI PA</span>
                <span className="block text-[10px] font-bold uppercase tracking-[0.34em] text-slate-600">AI PHONE AGENT</span>
              </span>
            </button>

            <nav className="mx-auto hidden items-center gap-2 rounded-full bg-[#edf2f0] p-1 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-600 ring-1 ring-slate-200 lg:flex">
              {["Features", "How It Works", "Pricing", "About"].map((item) => (
                <button key={item} type="button" className="rounded-full px-5 py-2 hover:bg-white hover:text-slate-900">
                  {item}
                </button>
              ))}
            </nav>

            <div className="ml-auto hidden items-center gap-6 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-700 md:flex">
              <button type="button" className="hover:text-slate-900">Login</button>
              <button type="button" className="hover:text-slate-900">Book a Demo</button>
              <button
                type="button"
                className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-6 py-3 text-white shadow-[0_16px_26px_-16px_rgba(16,185,129,0.8)]"
              >
                Get Started Free
              </button>
            </div>
          </div>
        </header>

        <section className="relative z-10 mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
          <div className="lg:pr-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/15 px-4 py-2 text-sm font-bold text-white/95 backdrop-blur">
              <IconSpark />
              Step 1 of 5: Find your business
            </div>

            <h1 className="mt-8 font-serif text-[64px] font-semibold leading-[0.96] tracking-tight text-white drop-shadow-[0_10px_35px_rgba(0,0,0,0.35)] sm:text-[84px] lg:text-[96px]">
              <span className="block">As easy as 5 steps...</span>
            </h1>

            <p className="mt-8 max-w-[760px] text-2xl font-extrabold leading-tight text-[#0c1736] sm:text-3xl">
              Just type in your business from Google and we&apos;ll automatically register an AI agent to your workplace!
            </p>

          </div>

          <div className="relative">
            <div className="pointer-events-none absolute -inset-4 rounded-[34px] bg-[radial-gradient(60%_70%_at_20%_10%,rgba(255,255,255,0.35),transparent_70%)] opacity-70" />
            <div className="relative rounded-[32px] border border-white/25 bg-[linear-gradient(180deg,rgba(10,12,18,0.78),rgba(8,10,16,0.88))] p-6 shadow-[0_45px_120px_-60px_rgba(0,0,0,0.85)] ring-1 ring-black/25 backdrop-blur">
              <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.28em] text-white/70">Business Finder</p>
                    <h2 className="mt-2 text-2xl font-extrabold text-white">Search your business on Google</h2>
                    <p className="mt-1 text-sm font-semibold text-white/65">We pull your business profile details to speed up setup.</p>
                  </div>
                  <CountryToggle country={country} setCountry={setCountry} />
                </div>

                {!apiKey && (
                  <div className="mt-5 rounded-2xl border border-amber-300/40 bg-amber-200/10 px-4 py-3 text-sm font-semibold text-amber-100">
                    Add <code className="font-bold">REACT_APP_GOOGLE_MAPS_API_KEY</code> to your environment to enable live Google business autocomplete.
                  </div>
                )}

                {mapsError && apiKey && (
                  <div className="mt-5 rounded-2xl border border-rose-300/35 bg-rose-200/10 px-4 py-3 text-sm font-semibold text-rose-100">
                    {mapsError}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="mt-5">
                  <div className="relative">
                    <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-black/25 px-4 py-4 text-white ring-1 ring-white/5">
                      <span className="text-white/70">
                        <IconSearch />
                      </span>
                      <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setSelectedPlace(null);
                          setShowPredictions(true);
                          setSearchError("");
                        }}
                        onFocus={() => setShowPredictions(true)}
                        placeholder="Enter your business name (ex: Olive Plumbing Seattle)"
                        className="w-full bg-transparent text-base font-semibold text-white placeholder:text-white/45 outline-none"
                        autoComplete="off"
                      />
                      <button
                        type="submit"
                        className="rounded-xl bg-[#f7bc1b] px-4 py-2 text-sm font-black text-slate-900 shadow-[0_12px_24px_-16px_rgba(180,83,9,0.55)]"
                      >
                        Search
                      </button>
                    </div>

                    {showPredictions && (predictions.length > 0 || isLoadingPredictions) && (
                      <div className="absolute left-0 right-0 top-[calc(100%+10px)] z-20 overflow-hidden rounded-2xl border border-white/15 bg-[#0f1422] shadow-[0_30px_70px_-30px_rgba(0,0,0,0.85)]">
                        {isLoadingPredictions && (
                          <div className="px-4 py-3 text-sm font-semibold text-white/70">Searching Google businesses...</div>
                        )}
                        {predictions.map((p) => (
                          <button
                            key={p.place_id}
                            type="button"
                            onClick={() => handleSelectPrediction(p)}
                            className="block w-full border-t border-white/5 px-4 py-3 text-left first:border-t-0 hover:bg-white/5"
                          >
                            <div className="text-sm font-bold text-white">{p.structured_formatting?.main_text || p.description}</div>
                            <div className="text-xs font-semibold text-white/55">
                              {p.structured_formatting?.secondary_text || p.description}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </form>

                {searchError && <p className="mt-3 text-sm font-semibold text-rose-200">{searchError}</p>}

                <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Selected Business</div>
                    {isLoadingDetails && <div className="text-xs font-bold text-white/70">Loading details...</div>}
                  </div>

                  {!selectedPlace ? (
                    <div className="mt-3 text-sm font-semibold text-white/55">
                      Choose a result above and we’ll import business name, address, phone, and profile details.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-xl border border-emerald-300/25 bg-emerald-200/10 px-4 py-3">
                        <div className="text-base font-extrabold text-white">{selectedPlace.name}</div>
                        <div className="mt-1 text-sm font-semibold text-white/70">{selectedPlace.formatted_address}</div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                          <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Phone</div>
                          <div className="mt-1 text-sm font-semibold text-white/85">
                            {selectedPlace.formatted_phone_number || "Not available"}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                          <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Rating</div>
                          <div className="mt-1 text-sm font-semibold text-white/85">
                            {selectedPlace.rating
                              ? `${selectedPlace.rating} (${selectedPlace.user_ratings_total || 0} reviews)`
                              : "Not available"}
                          </div>
                        </div>
                      </div>

                      {selectedPlace.website && (
                        <a
                          href={selectedPlace.website}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center text-sm font-bold text-emerald-200 underline underline-offset-4"
                        >
                          Open website →
                        </a>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={!canContinue}
                    className={
                      "rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.14em] transition " +
                      (canContinue
                        ? "bg-gradient-to-r from-emerald-700 to-amber-500 text-white shadow-[0_18px_28px_-18px_rgba(16,185,129,0.8)]"
                        : "cursor-not-allowed bg-white/10 text-white/40")
                    }
                  >
                    Continue Setup
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManualDetails((v) => !v)}
                    className={
                      "rounded-full border px-5 py-3 text-sm font-bold transition " +
                      (showManualDetails
                        ? "border-emerald-300/40 bg-emerald-200/10 text-emerald-100"
                        : "border-white/20 text-white/75 hover:bg-white/5")
                    }
                  >
                    {showManualDetails ? "Hide manual details" : "Enter details manually"}
                  </button>
                </div>

                {showManualDetails && (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Manual Business Details</div>
                    <p className="mt-2 text-sm font-semibold text-white/55">
                      Add your business info manually and we&apos;ll use it to configure your AI agent.
                    </p>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-white/50">Business name</div>
                        <input
                          type="text"
                          value={manualDetails.businessName}
                          onChange={handleManualDetailChange("businessName")}
                          placeholder="Olive Plumbing"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white placeholder:text-white/35 outline-none focus:border-emerald-300/40"
                        />
                      </label>
                      <label className="block">
                        <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-white/50">Phone</div>
                        <input
                          type="text"
                          value={manualDetails.phone}
                          onChange={handleManualDetailChange("phone")}
                          placeholder="(555) 123-4567"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white placeholder:text-white/35 outline-none focus:border-emerald-300/40"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-white/50">Address</div>
                        <input
                          type="text"
                          value={manualDetails.address}
                          onChange={handleManualDetailChange("address")}
                          placeholder="123 Main St, City, State"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white placeholder:text-white/35 outline-none focus:border-emerald-300/40"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-white/50">Website (optional)</div>
                        <input
                          type="url"
                          value={manualDetails.website}
                          onChange={handleManualDetailChange("website")}
                          placeholder="https://yourbusiness.com"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white placeholder:text-white/35 outline-none focus:border-emerald-300/40"
                        />
                      </label>
                      <label className="block">
                        <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-white/50">Business hours</div>
                        <textarea
                          value={manualDetails.hours}
                          onChange={handleManualDetailChange("hours")}
                          placeholder="Mon-Fri 8am-6pm, Sat 9am-2pm"
                          rows={4}
                          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white placeholder:text-white/35 outline-none focus:border-emerald-300/40"
                        />
                      </label>
                      <label className="block">
                        <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-white/50">Services / notes</div>
                        <textarea
                          value={manualDetails.services}
                          onChange={handleManualDetailChange("services")}
                          placeholder="Drain cleaning, water heaters, emergency repair..."
                          rows={4}
                          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white placeholder:text-white/35 outline-none focus:border-emerald-300/40"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {selectedSummary && <p className="mt-4 text-xs font-semibold text-white/55">Imported: {selectedSummary}</p>}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
