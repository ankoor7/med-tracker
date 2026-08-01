// Stage 20 Unit 3 (FR-20.1 / FR-20.4) — themed form-field primitives built on
// React Aria Components. They replace the hand-rolled `<input>` + ad-hoc error
// paragraphs the merged medication editor used, so validation now surfaces as
// an accessible `FieldError` (wired via `aria-describedby` / `aria-invalid`)
// rather than a loose `<p>`.
//
// The pure core (`validateMedication`) stays the source of truth: callers pass
// its message in as `errorMessage`, and the field renders it accessibly with
// `isInvalid`. `validationBehavior="aria"` marks the field invalid for assistive
// tech without blocking submission (the editor keeps its own `canSave` gate).

import {
  Button as RACButton,
  DateField as RACDateField,
  DateInput,
  DateSegment,
  FieldError,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  NumberField as RACNumberField,
  Popover,
  Select,
  SelectValue,
  Text,
  TextField as RACTextField,
  TimeField as RACTimeField,
  type DateValue,
  type TimeValue,
} from 'react-aria-components';
import { ColorDot, inputClass } from './ui';

// `toTimeValue`/`fromTimeValue` (./timeValue) and `toDateValue`/`fromDateValue`
// (./dateValue) live in their own modules so this module exports components
// only (react-refresh/only-export-components).

const labelClass = 'text-xs font-medium uppercase tracking-wide text-slate-400';
const hintClass = 'text-xs font-normal normal-case text-slate-500';
const errorClass = 'text-xs text-status-missed';
// Shared by TimeField and DateField — both render a `DateInput` of
// individually-focusable segments.
const dateSegmentClass =
  'rounded px-0.5 tabular-nums outline-none data-[focused]:bg-accent/20 data-[placeholder]:text-slate-500';

/**
 * The label + segmented `DateInput` + hint body shared by `TimeField` and
 * `DateField` — both are React Aria `*Field` components that differ only in
 * which segments they show (time vs. date), so the JSX around the
 * `DateInput` itself would otherwise be duplicated verbatim between them.
 */
function SegmentedFieldBody({ label, hint }: { label?: string; hint?: string }) {
  return (
    <>
      {label && <Label className={labelClass}>{label}</Label>}
      <DateInput className={`${inputClass} flex w-fit gap-0.5`}>
        {(segment) => <DateSegment segment={segment} className={dateSegmentClass} />}
      </DateInput>
      {hint && (
        <Text slot="description" className={hintClass}>
          {hint}
        </Text>
      )}
    </>
  );
}

export function NumberField({
  label,
  'aria-label': ariaLabel,
  hint,
  value,
  onChange,
  errorMessage,
  className = '',
  inputClassName = '',
}: {
  label?: string;
  'aria-label'?: string;
  hint?: string;
  /** Undefined renders an empty field (e.g. an unset guardrail cap). */
  value: number | undefined;
  onChange: (value: number) => void;
  errorMessage?: string;
  className?: string;
  inputClassName?: string;
}) {
  return (
    <RACNumberField
      aria-label={ariaLabel}
      value={value ?? Number.NaN}
      onChange={onChange}
      isInvalid={errorMessage != null}
      validationBehavior="aria"
      // No min/max clamping: the core validates non-positive/over-cap values so
      // the user sees the specific message rather than a silently clamped value.
      formatOptions={{ maximumFractionDigits: 4 }}
      className={`flex flex-col gap-1.5 text-sm ${className}`}
    >
      {label && <Label className={labelClass}>{label}</Label>}
      <Input className={`${inputClass} ${inputClassName}`} />
      {hint && (
        <Text slot="description" className={hintClass}>
          {hint}
        </Text>
      )}
      <FieldError className={errorClass}>{errorMessage}</FieldError>
    </RACNumberField>
  );
}

export function TextField({
  label,
  'aria-label': ariaLabel,
  hint,
  value,
  onChange,
  placeholder,
  errorMessage,
  type = 'text',
  className = '',
}: {
  label?: string;
  'aria-label'?: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  errorMessage?: string;
  /** Native input type — e.g. `'email'`/`'password'`. Defaults to `'text'`. */
  type?: string;
  className?: string;
}) {
  return (
    <RACTextField
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      isInvalid={errorMessage != null}
      validationBehavior="aria"
      className={`flex flex-col gap-1.5 text-sm ${className}`}
    >
      {label && <Label className={labelClass}>{label}</Label>}
      <Input className={inputClass} placeholder={placeholder} type={type} />
      {hint && (
        <Text slot="description" className={hintClass}>
          {hint}
        </Text>
      )}
      <FieldError className={errorClass}>{errorMessage}</FieldError>
    </RACTextField>
  );
}

export function TimeField({
  label,
  'aria-label': ariaLabel,
  hint,
  value,
  onChange,
  className = '',
}: {
  label?: string;
  'aria-label'?: string;
  hint?: string;
  value: TimeValue | null;
  onChange: (value: TimeValue | null) => void;
  className?: string;
}) {
  return (
    <RACTimeField
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      hourCycle={24}
      granularity="minute"
      shouldForceLeadingZeros
      className={`flex flex-col gap-1.5 text-sm ${className}`}
    >
      <SegmentedFieldBody label={label} hint={hint} />
    </RACTimeField>
  );
}

export function DateField({
  label,
  'aria-label': ariaLabel,
  hint,
  value,
  onChange,
  className = '',
}: {
  label?: string;
  'aria-label'?: string;
  hint?: string;
  value: DateValue | null;
  onChange: (value: DateValue | null) => void;
  className?: string;
}) {
  return (
    <RACDateField
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      shouldForceLeadingZeros
      className={`flex flex-col gap-1.5 text-sm ${className}`}
    >
      <SegmentedFieldBody label={label} hint={hint} />
    </RACDateField>
  );
}

const selectTriggerClass =
  'flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-left text-sm text-slate-100 outline-none data-[focus-visible]:border-accent-muted data-[hovered]:border-white/20 disabled:opacity-50';
const selectPopoverClass =
  'w-[--trigger-width] overflow-auto rounded-xl border border-white/10 bg-slate-900/95 p-1 shadow-soft backdrop-blur-md';
const selectItemClass =
  'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[focused]:bg-accent/15 data-[selected]:bg-accent/10';

/** One choice in a `ChoiceSelect`; `color` renders a leading `ColorDot`. */
export interface SelectChoice {
  id: string;
  name: string;
  color?: string;
}

/**
 * The themed React Aria `Select` the app uses for every short fixed-vocabulary
 * picker: property type, event type, and (Stage 24 FR-24.2) the medication an
 * event is attributed to. The event-type and medication pickers rendered
 * character-identical `Select`/`Popover`/`ListBox` trees that differed only in
 * their items, so they are one component here rather than three copies.
 *
 * Selection is a plain id; `''` means "nothing selected" and shows the
 * trigger's placeholder.
 */
export function ChoiceSelect({
  'aria-label': ariaLabel,
  choices,
  selectedId,
  isDisabled = false,
  onChange,
}: {
  'aria-label': string;
  choices: SelectChoice[];
  selectedId: string;
  isDisabled?: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <Select
      aria-label={ariaLabel}
      selectedKey={selectedId || null}
      isDisabled={isDisabled}
      onSelectionChange={(key) => onChange(String(key))}
    >
      <RACButton className={selectTriggerClass}>
        <SelectValue />
        <span aria-hidden className="text-slate-400">
          ▾
        </span>
      </RACButton>
      <Popover className={selectPopoverClass}>
        <ListBox items={choices}>
          {(choice) => (
            <ListBoxItem id={choice.id} textValue={choice.name} className={selectItemClass}>
              {choice.color !== undefined && <ColorDot color={choice.color} />}
              {choice.name}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}
