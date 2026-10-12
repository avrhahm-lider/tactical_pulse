import React from 'react'

interface DroneIconProps {
  className?: string
  size?: number
  color?: string
}

export const DroneIcon: React.FC<DroneIconProps> = ({
  className = '',
  size = 20,
  color = 'currentColor',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Central body fuselage */}
      <rect
        x="9"
        y="9"
        width="6"
        height="6"
        rx="1.5"
        fill={color}
        fillOpacity="0.25"
        stroke={color}
        strokeWidth="1.8"
      />
      {/* 4 Diagonal arms extending to rotors */}
      <line x1="6.5" y1="6.5" x2="9" y2="9" stroke={color} strokeWidth="2" />
      <line x1="17.5" y1="6.5" x2="15" y2="9" stroke={color} strokeWidth="2" />
      <line x1="6.5" y1="17.5" x2="9" y2="15" stroke={color} strokeWidth="2" />
      <line x1="17.5" y1="17.5" x2="15" y2="15" stroke={color} strokeWidth="2" />
      {/* 4 Circular rotor housings */}
      <circle cx="5" cy="5" r="3" stroke={color} strokeWidth="1.8" />
      <circle cx="19" cy="5" r="3" stroke={color} strokeWidth="1.8" />
      <circle cx="5" cy="19" r="3" stroke={color} strokeWidth="1.8" />
      <circle cx="19" cy="19" r="3" stroke={color} strokeWidth="1.8" />
      {/* Propeller rotor blades */}
      <line x1="2.8" y1="5" x2="7.2" y2="5" stroke={color} strokeWidth="1.4" />
      <line x1="16.8" y1="5" x2="21.2" y2="5" stroke={color} strokeWidth="1.4" />
      <line x1="2.8" y1="19" x2="7.2" y2="19" stroke={color} strokeWidth="1.4" />
      <line x1="16.8" y1="19" x2="21.2" y2="19" stroke={color} strokeWidth="1.4" />
    </svg>
  )
}

export function getDroneSvgString(size = 18, color = '#ffffff'): string {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="6" height="6" rx="1.5" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="1.8" />
      <line x1="6.5" y1="6.5" x2="9" y2="9" stroke="${color}" stroke-width="2" />
      <line x1="17.5" y1="6.5" x2="15" y2="9" stroke="${color}" stroke-width="2" />
      <line x1="6.5" y1="17.5" x2="9" y2="15" stroke="${color}" stroke-width="2" />
      <line x1="17.5" y1="17.5" x2="15" y2="15" stroke="${color}" stroke-width="2" />
      <circle cx="5" cy="5" r="3" stroke="${color}" stroke-width="1.8" />
      <circle cx="19" cy="5" r="3" stroke="${color}" stroke-width="1.8" />
      <circle cx="5" cy="19" r="3" stroke="${color}" stroke-width="1.8" />
      <circle cx="19" cy="19" r="3" stroke="${color}" stroke-width="1.8" />
      <line x1="2.8" y1="5" x2="7.2" y2="5" stroke="${color}" stroke-width="1.4" />
      <line x1="16.8" y1="5" x2="21.2" y2="5" stroke="${color}" stroke-width="1.4" />
      <line x1="2.8" y1="19" x2="7.2" y2="19" stroke="${color}" stroke-width="1.4" />
      <line x1="16.8" y1="19" x2="21.2" y2="19" stroke="${color}" stroke-width="1.4" />
    </svg>
  `
}

export function getOtherThreatSvgString(size = 18, color = '#ffffff'): string {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" fill="${color}" fill-opacity="0.25"/>
      <line x1="12" y1="9" x2="12" y2="13" stroke-width="2.2"/>
      <line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2.5"/>
    </svg>
  `
}
