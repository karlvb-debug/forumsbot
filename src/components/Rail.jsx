import React from 'react';
import * as Ic from './Icons';

export function Rail({ nav, active, onSelect, theme, onToggleTheme, onOpenCmd }) {
  const primary = nav.filter(n => n.tier === 'primary');
  const advanced = nav.filter(n => n.tier === 'advanced');
  const bottom = nav.filter(n => n.tier === 'bottom');

  const renderBtn = (n) => {
    const Icon = Ic[n.icon];
    if (!Icon) return null;
    return (
      <button
        key={n.id}
        className={'rail-btn' + (active === n.id ? ' active' : '')}
        onClick={() => onSelect(n.id)}
        title={n.label}
        aria-label={n.label}
        aria-current={active === n.id ? 'page' : undefined}
      >
        <Icon />
        <span className="rail-tip">{n.label}</span>
      </button>
    );
  };

  return (
    <nav className="rail" aria-label="Systems">
      <div className="rail-brand" title="Forum">F</div>

      <div className="rail-group" aria-label="Primary">
        {primary.map(renderBtn)}
      </div>

      <div className="rail-divider" role="separator" />

      <div className="rail-group" aria-label="Advanced">
        {advanced.map(renderBtn)}
      </div>

      <div className="rail-spacer" />

      <div className="rail-group">
        <button className="rail-btn" onClick={onOpenCmd} title="Command palette (⌘K)">
          <Ic.Cmd />
          <span className="rail-tip">Command palette · ⌘K</span>
        </button>
        {bottom.map(renderBtn)}
        <button
          className="rail-btn"
          onClick={onToggleTheme}
          title="Toggle theme"
          aria-label="Toggle light/dark theme"
        >
          {theme === 'dark' ? <Ic.Sun /> : <Ic.Moon />}
          <span className="rail-tip">Toggle theme</span>
        </button>
      </div>
    </nav>
  );
}
