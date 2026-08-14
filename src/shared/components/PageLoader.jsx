export default function PageLoader() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 10000,
        background: 'linear-gradient(90deg, #10B981 0%, #34D399 40%, #6EE7B7 60%, #10B981 100%)',
        backgroundSize: '200% 100%',
        animation: 'zed-page-load 1.4s ease-in-out infinite',
      }}
    />
  )
}
