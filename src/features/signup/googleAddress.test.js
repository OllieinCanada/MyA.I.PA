import { canadianAddressFromPlace } from "./googleAddress";
export const canadianPlace = (overrides = {}) => ({ addressComponents: Object.entries({ street_number: "277", route: "Mud Street", locality: "Hamilton", administrative_area_level_1: "ON", postal_code: "l8j3z6", country: "CA", ...overrides }).map(([type, text]) => ({ types: [type], longText: text, shortText: text })) });
test("maps Canadian components to all four fields and formats postal code", () => {
  expect(canadianAddressFromPlace(canadianPlace())).toEqual({ streetAddress: "277 Mud Street", city: "Hamilton", province: "ON", postalCode: "L8J 3Z6" });
});
test("retains units, supports Quebec and does not invent missing postal codes", () => {
  expect(canadianAddressFromPlace(canadianPlace({ subpremise: "4", administrative_area_level_1: "QC", postal_code: "" }))).toMatchObject({ streetAddress: "4-277 Mud Street", province: "QC", postalCode: "" });
});
test("rejects non-Canadian, province-less and street-number-less results", () => {
  expect(() => canadianAddressFromPlace(canadianPlace({ country: "US" }))).toThrow();
  expect(() => canadianAddressFromPlace(canadianPlace({ administrative_area_level_1: "" }))).toThrow();
  expect(() => canadianAddressFromPlace(canadianPlace({ street_number: "" }))).toThrow();
});
