import axios from "axios";
import mongoose from "mongoose";
import User from "../models/User";
import {
  RevenueCatEntitlement,
  RevenueCatPlanState,
  RevenueCatSubscriber,
  RevenueCatSubscriberResponse,
} from "../types/revenueCat";

const REVENUECAT_API_BASE_URL = "https://api.revenuecat.com/v1";
const DEFAULT_ENTITLEMENT_ID = "pro";

const getEntitlementId = () =>
  process.env.REVENUECAT_ENTITLEMENT_ID || DEFAULT_ENTITLEMENT_ID;

const getRevenueCatSecretKey = () => {
  const secretKey = process.env.REVENUECAT_SECRET_KEY;
  if (!secretKey) {
    throw new Error("REVENUECAT_SECRET_KEY is not configured.");
  }

  return secretKey;
};

const isEntitlementActive = (entitlement?: RevenueCatEntitlement) => {
  if (!entitlement) return false;
  if (!entitlement.expires_date) return true;

  return new Date(entitlement.expires_date).getTime() > Date.now();
};

const getSubscriptionExpiresAt = (expiresDate?: string | null) =>
  expiresDate ? new Date(expiresDate) : null;

const getPlanState = (subscriber?: RevenueCatSubscriber): RevenueCatPlanState => {
  const entitlement = subscriber?.entitlements?.[getEntitlementId()];

  if (!isEntitlementActive(entitlement)) {
    return {
      plan: "free",
      subscriptionExpiresAt: null,
      subscriptionId: null,
      subscriptionStatus: "none",
    };
  }

  const productId = entitlement?.product_identifier || null;
  const subscription = productId ? subscriber?.subscriptions?.[productId] : undefined;
  const subscriptionStatus = subscription?.billing_issues_detected_at
    ? "past_due"
    : subscription?.unsubscribe_detected_at
      ? "canceled"
      : "active";

  return {
    plan: "pro",
    subscriptionExpiresAt: getSubscriptionExpiresAt(entitlement?.expires_date),
    subscriptionId: productId ? `revenuecat:${productId}` : "revenuecat:pro",
    subscriptionStatus,
  };
};

const getPublicUser = (user: any) => ({
  id: user._id.toString(),
  username: user.username,
  email: user.email,
  plan: user.plan || "free",
  role: user.role || "user",
});

export const fetchRevenueCatSubscriber = async (appUserId: string) => {
  const response = await axios.get<RevenueCatSubscriberResponse>(
    `${REVENUECAT_API_BASE_URL}/subscribers/${encodeURIComponent(appUserId)}`,
    {
      headers: {
        Authorization: `Bearer ${getRevenueCatSecretKey()}`,
      },
      timeout: 5000,
    },
  );

  return response.data.subscriber;
};

const findUserByRevenueCatAppUserId = (appUserId: string) => {
  if (!mongoose.isValidObjectId(appUserId)) return null;

  return User.findById(appUserId);
};

const syncRevenueCatPlanForExistingUser = async (user: any) => {
  const subscriber = await fetchRevenueCatSubscriber(user._id.toString());
  const planState = getPlanState(subscriber);

  user.plan = planState.plan;
  user.subscriptionStatus = planState.subscriptionStatus;
  user.subscriptionId = planState.subscriptionId;
  user.subscriptionExpiresAt = planState.subscriptionExpiresAt;

  await user.save();

  return getPublicUser(user);
};

export const syncRevenueCatPlanForUser = async (userId: string) => {
  const user = await findUserByRevenueCatAppUserId(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  return syncRevenueCatPlanForExistingUser(user);
};

export const trySyncRevenueCatPlanForUser = async (userId: string) => {
  const user = await findUserByRevenueCatAppUserId(userId);
  if (!user) return null;

  return syncRevenueCatPlanForExistingUser(user);
};
