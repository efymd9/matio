import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { startCheckout } from "./actions";

export default function SubscribePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-12">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Choose a plan</h1>
        <p className="mt-2 text-muted-foreground">Cancel anytime.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PlanCard
          plan="monthly"
          title="Monthly"
          price="$9.99"
          interval="month"
        />
        <PlanCard
          plan="annual"
          title="Annual"
          price="$79.99"
          interval="year"
          note="Save ~33% vs monthly"
        />
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  title,
  price,
  interval,
  note,
}: {
  plan: "monthly" | "annual";
  title: string;
  price: string;
  interval: string;
  note?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="text-3xl font-semibold">{price}</span>
          <span className="text-muted-foreground"> / {interval}</span>
        </div>
        {note && <p className="text-sm text-green-600">{note}</p>}
        <form action={startCheckout}>
          <input type="hidden" name="plan" value={plan} />
          <Button type="submit" className="w-full">
            Subscribe
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
