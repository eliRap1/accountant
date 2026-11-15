"use client";

import { useTranslations } from "next-intl";
import { SelectField } from "@/components/app/ui/Field";

export const PROCESSORS = ["hyp", "grow", "payplus"] as const;

export default function ProcessorPicker({
  processor,
  onChange,
  disabled,
}: {
  processor: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}): React.ReactNode {
  const t = useTranslations("app.processorSync");
  return (
    <SelectField
      label={t("processorLabel")}
      name="processor"
      value={processor}
      onChange={onChange}
      options={PROCESSORS.map((p) => ({
        value: p,
        label: t(`processor.${p}`),
      }))}
      disabled={disabled ?? false}
    />
  );
}
