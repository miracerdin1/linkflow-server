export interface AuthTokenPayload {
  id: string;
  username: string;
  email: string;
  role: "user" | "admin";
}
