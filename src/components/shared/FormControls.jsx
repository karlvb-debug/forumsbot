import React from 'react';
import * as Ic from '../Icons';

export const Field = ({ label, hint, children, info }) => {
  const autoId = React.useId();
  // A Fragment is a valid element but only accepts `key`/`children`, so it can't
  // receive an injected id/aria-describedby — treat it like a multi-child group.
  const single = React.isValidElement(children)
    && React.Children.count(children) === 1
    && children.type !== React.Fragment;
  const controlId = single ? (children.props.id || autoId) : undefined;
  const hintId = hint ? `${autoId}-hint` : undefined;

  // Associate the single form control with its label + hint for screen readers.
  const control = single
    ? React.cloneElement(children, {
        id: controlId,
        'aria-describedby': [children.props['aria-describedby'], hintId].filter(Boolean).join(' ') || undefined,
      })
    : children;

  return (
    <div className="field">
      <label className="field-label" htmlFor={controlId}>
        {label}
        {info ? <span className="info" title={info}><Ic.Info width={11} height={11} /></span> : null}
      </label>
      {control}
      {hint ? <div className="field-hint" id={hintId}>{hint}</div> : null}
    </div>
  );
};

export const Toggle = ({ checked, onChange, label }) => (
  <label className="toggle">
    <input type="checkbox" checked={checked} onChange={(e) => onChange?.(e.target.checked)} />
    <span className="track" />
    {label ? <span>{label}</span> : null}
  </label>
);

export const Range = ({ value, onChange, min = 0, max = 1, step = 0.05, format = (v) => v.toFixed(2) }) => (
  <div className="range-row">
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange?.(parseFloat(e.target.value))} />
    <span className="range-val">{format(value)}</span>
  </div>
);

export const Seg = ({ options, value, onChange, full }) => (
  <div className={"seg" + (full ? " full" : "")}>
    {options.map((o) => (
      <button key={o.value} className={value === o.value ? "active" : ""} onClick={() => onChange?.(o.value)}>{o.label}</button>
    ))}
  </div>
);
