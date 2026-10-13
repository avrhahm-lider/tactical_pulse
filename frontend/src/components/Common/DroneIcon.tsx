import React from 'react'

interface DroneIconProps {
  size?: number
  color?: string
  className?: string
}

export const DroneIcon: React.FC<DroneIconProps> = ({
  size = 20,
  color = 'currentColor',
  className = '',
}) => (
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
    <rect x="9" y="9" width="6" height="6" rx="1.5" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="1.8" />
    <line x1="6.5" y1="6.5" x2="9" y2="9" stroke={color} strokeWidth="2" />
    <line x1="17.5" y1="6.5" x2="15" y2="9" stroke={color} strokeWidth="2" />
    <line x1="6.5" y1="17.5" x2="9" y2="15" stroke={color} strokeWidth="2" />
    <line x1="17.5" y1="17.5" x2="15" y2="15" stroke={color} strokeWidth="2" />
    <circle cx="5" cy="5" r="3" stroke={color} strokeWidth="1.8" />
    <circle cx="19" cy="5" r="3" stroke={color} strokeWidth="1.8" />
    <circle cx="5" cy="19" r="3" stroke={color} strokeWidth="1.8" />
    <circle cx="19" cy="19" r="3" stroke={color} strokeWidth="1.8" />
    <line x1="2.8" y1="5" x2="7.2" y2="5" stroke={color} strokeWidth="1.4" />
    <line x1="16.8" y1="5" x2="21.2" y2="5" stroke={color} strokeWidth="1.4" />
    <line x1="2.8" y1="19" x2="7.2" y2="19" stroke={color} strokeWidth="1.4" />
    <line x1="16.8" y1="19" x2="21.2" y2="19" stroke={color} strokeWidth="1.4" />
  </svg>
)
