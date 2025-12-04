var PLAN_CATEGORIES = [
  { value: "auto", label: "Auto detect" },
  { value: "Barnehager", label: "Barnehager" },
  { value: "Normal office", label: "Normal office" },
  { value: "Klinikk", label: "Klinikk" },
  { value: "Car stores", label: "Car stores" },
  { value: "Convenient stores", label: "Convenient stores" },
  { value: "Schools", label: "Schools" },
  { value: "Bar / restaurants", label: "Bar / restaurants" }
];
    referenceUnit: "m",
    planCategory: "auto"
        reference_unit: options.referenceUnit,
        plan_category: options.planCategory === "auto" ? null : options.planCategory
  ), /* @__PURE__ */ import_react3.default.createElement("div", { className: "p-4 border border-gray-200 rounded-lg bg-gradient-to-r from-indigo-50 to-white" }, /* @__PURE__ */ import_react3.default.createElement("h4", { className: "font-medium text-gray-900" }, "Velg kategori for renholdsplan"), /* @__PURE__ */ import_react3.default.createElement("p", { className: "text-sm text-gray-500 mt-1" }, "Systemet fors\xF8ker \xE5 autodetektere type areal. Velg en kategori dersom du vil overstyre valget f\xF8r generering."), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mt-3" }, /* @__PURE__ */ import_react3.default.createElement("label", { className: "text-xs font-semibold text-gray-600 mb-1 block" }, "Kategori"), /* @__PURE__ */ import_react3.default.createElement(
    "select",
    {
      className: "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500",
      value: options.planCategory,
      onChange: (e) => setOptions((prev) => ({ ...prev, planCategory: e.target.value }))
    },
    PLAN_CATEGORIES.map((category) => /* @__PURE__ */ import_react3.default.createElement("option", { key: category.value, value: category.value }, category.label))
  ))), /* @__PURE__ */ import_react3.default.createElement(
