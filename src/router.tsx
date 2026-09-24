import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Surface data-loading failures (e.g. database unreachable) instead of rendering them as empty screens.
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (typeof window === "undefined") return;
        toast.error(`Couldn't load data: ${error.message}`, { id: `query-error:${error.message}` });
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
