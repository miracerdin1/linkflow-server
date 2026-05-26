export interface RevenueCatEntitlement {
  expires_date?: string | null;
  product_identifier?: string | null;
}

export interface RevenueCatSubscription {
  billing_issues_detected_at?: string | null;
  expires_date?: string | null;
  store?: string | null;
  unsubscribe_detected_at?: string | null;
}

export interface RevenueCatSubscriber {
  entitlements?: Record<string, RevenueCatEntitlement | undefined>;
  subscriptions?: Record<string, RevenueCatSubscription | undefined>;
}

export interface RevenueCatSubscriberResponse {
  subscriber?: RevenueCatSubscriber;
}

export interface RevenueCatPlanState {
  plan: "free" | "pro";
  subscriptionExpiresAt: Date | null;
  subscriptionId: string | null;
  subscriptionStatus: "active" | "canceled" | "past_due" | "none";
}
