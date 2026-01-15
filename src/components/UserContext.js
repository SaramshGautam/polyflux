// src/context/UserContext.js
import { createContext, useContext } from "react";

export const UserContext = createContext({
  actorId: "anon",
  actorName: "Anonymous",
});

export function useUser() {
  return useContext(UserContext);
}
