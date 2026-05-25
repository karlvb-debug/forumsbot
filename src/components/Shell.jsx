import React from 'react';

export function Shell({ children, inspectorOnLeft }) {
  return (
    <div className={'shell' + (inspectorOnLeft ? ' inspector-left' : '')}>
      {children}
    </div>
  );
}
