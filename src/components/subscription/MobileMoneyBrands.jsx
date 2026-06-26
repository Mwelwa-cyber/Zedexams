// Accepted mobile-money networks shown above the checkout phone input so payers
// know — at a glance — that Airtel, MTN and Zamtel all work. Uses the official
// network artwork (public/images/mobile-money-networks.jpg). The network the
// payer actually pays with is auto-detected from their number and confirmed in
// the NetworkField below — this row is purely informational.
export default function MobileMoneyBrands({ className = '' }) {
  return (
    <div className={className}>
      <img
        src="/images/mobile-money-networks.jpg"
        alt="Accepted networks: Airtel Money, MTN Mobile Money and Zamtel Money"
        className="mx-auto block h-12 w-auto max-w-full object-contain"
        loading="lazy"
      />
      <p className="mt-2 text-center text-[11px] text-gray-500">
        Pay with Airtel, MTN or Zamtel — you&apos;ll receive a prompt on your phone to approve.
      </p>
    </div>
  )
}
