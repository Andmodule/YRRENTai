export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <h1 className="text-5xl font-bold tracking-tight">RentAI</h1>
      <p className="mt-4 text-xl text-gray-600">
        AI-powered assistant for short-term rental management
      </p>
      <div className="mt-8 flex gap-4">
        <a
          href="/signup"
          className="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 transition-colors"
        >
          Get Started
        </a>
        <a
          href="#features"
          className="rounded-lg border border-gray-300 px-6 py-3 font-medium hover:bg-gray-50 transition-colors"
        >
          Learn More
        </a>
      </div>
    </main>
  );
}
