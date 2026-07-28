const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatIstDate(value: Date = new Date()) {
  return IST_DATE_FORMATTER.format(value);
}

export function getIstYearMonth(value: Date = new Date()) {
  const [yearText, monthText] = formatIstDate(value).split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  return {
    year,
    month: monthNumber - 1,
    monthStr: `${yearText}-${monthText}`,
  };
}
