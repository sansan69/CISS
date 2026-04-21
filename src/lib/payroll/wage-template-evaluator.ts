import type { WageTemplateConstant, WageTemplateRule } from "@/types/payroll";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function evaluateExpression(expression: string, scope: Record<string, number>) {
  const replaced = expression.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (token) => {
    if (token === "Math" || token === "min" || token === "max") return token;
    return String(scope[token] ?? 0);
  });

  const fn = new Function("min", "max", `return (${replaced});`);
  return Number(fn(Math.min, Math.max));
}

export function evaluateWageTemplate(input: {
  constants: WageTemplateConstant[];
  rules: WageTemplateRule[];
  attendance: Record<string, number>;
  seededComponents?: Record<string, number>;
}) {
  const scope: Record<string, number> = {
    ...(input.seededComponents ?? {}),
    ...input.attendance,
  };
  const components: Record<string, number> = {
    ...(input.seededComponents ?? {}),
  };

  input.constants.forEach((constant) => {
    scope[constant.key] = constant.value;
  });

  const orderedRules = [...input.rules].sort((a, b) => a.order - b.order);

  orderedRules.forEach((rule) => {
    if (rule.ruleType === "attendance_bound") {
      components[rule.standardName] = round2(scope[rule.attendanceKey || rule.standardName] ?? 0);
      scope[rule.standardName] = components[rule.standardName];
      return;
    }

    if (rule.ruleType === "summary_only" && rule.expression === "sum(earnings)") {
      const total = rule.dependsOn.reduce((sum, key) => sum + (components[key] ?? scope[key] ?? 0), 0);
      components[rule.standardName] = round2(total);
      scope[rule.standardName] = components[rule.standardName];
      return;
    }

    if (rule.expression) {
      const value = evaluateExpression(rule.expression, { ...scope, ...components });
      components[rule.standardName] = round2(Number.isFinite(value) ? value : 0);
      scope[rule.standardName] = components[rule.standardName];
      return;
    }

    components[rule.standardName] = 0;
    scope[rule.standardName] = 0;
  });

  return { components };
}
