(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const forms = [document.getElementById("loadForm"), document.getElementById("editLoadForm")].filter(Boolean);
    forms.forEach(form => {
      form.addEventListener("input", () => renderRateIntelligence(form));
      form.addEventListener("change", () => renderRateIntelligence(form));
      renderRateIntelligence(form);
    });
  });

  function renderRateIntelligence(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const revenue = totalRevenue(data);
    const cost = totalCost(data);
    const profit = revenue - cost;
    const margin = revenue ? (profit / revenue) * 100 : 0;
    const miles = toNumber(data.loaded_miles) + toNumber(data.empty_miles);
    const profitPerMile = miles ? profit / miles : 0;

    setText("rateProfit", formatCurrency(profit));
    setText("rateMargin", `${margin.toFixed(1)}%`);
    setText("rateProfitPerMile", `${formatCurrency(profitPerMile)}/mi`);
    setText("targetRate15", formatCurrency(targetRate(cost, data, 0.15)));
    setText("targetRate20", formatCurrency(targetRate(cost, data, 0.20)));
    setText("targetRate25", formatCurrency(targetRate(cost, data, 0.25)));

    const panel = document.querySelector(".rate-intelligence-panel");
    const status = document.getElementById("rateIntelligenceStatus");
    const summary = document.getElementById("rateIntelligenceSummary");
    if (!panel || !status || !summary) return;

    panel.classList.remove("rate-good", "rate-watch", "rate-danger");

    if (!revenue && !cost) {
      status.textContent = "Enter rate and costs";
      summary.textContent = "HyperRoute will estimate profit, margin, and target rates before you save.";
      return;
    }

    if (margin < 0) {
      panel.classList.add("rate-danger");
      status.textContent = "This load is priced below cost";
      summary.textContent = `Current estimate loses ${formatCurrency(Math.abs(profit))}. Target 20% rate is ${formatCurrency(targetRate(cost, data, 0.20))}.`;
    } else if (margin < 12) {
      panel.classList.add("rate-watch");
      status.textContent = "Margin is below target";
      summary.textContent = `Current margin is ${margin.toFixed(1)}%. Consider at least ${formatCurrency(targetRate(cost, data, 0.20))} for a 20% margin.`;
    } else {
      panel.classList.add("rate-good");
      status.textContent = "Rate looks workable";
      summary.textContent = `Estimated profit is ${formatCurrency(profit)} with ${margin.toFixed(1)}% margin.`;
    }
  }

  function totalRevenue(data) {
    return toNumber(data.rate) + toNumber(data.detention_billed) + toNumber(data.accessorial_billed);
  }

  function totalCost(data) {
    return toNumber(data.carrier_rate) +
      toNumber(data.fuel_cost) +
      toNumber(data.toll_cost) +
      toNumber(data.detention_paid) +
      toNumber(data.lumper_cost) +
      toNumber(data.other_costs);
  }

  function targetRate(cost, data, marginTarget) {
    if (!cost) return 0;
    const extraRevenue = toNumber(data.detention_billed) + toNumber(data.accessorial_billed);
    return Math.max(0, (cost / (1 - marginTarget)) - extraRevenue);
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(toNumber(value));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
})();
