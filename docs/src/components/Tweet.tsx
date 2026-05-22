/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";
import { Suspense } from "react";
import { enrichTweet, type EnrichedTweet, type TweetProps } from "react-tweet";
import { getTweet, type Tweet } from "react-tweet/api";
import { TweetBody, TweetHeader, TweetMedia } from "./TweetClient";
import { TweetErrorBoundary } from "./TweetErrorBoundary";

const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return <div className={cn("rounded-md bg-primary/10", className)} {...props} />;
};

export const TweetSkeleton = ({ className, ...props }: { className?: string; [key: string]: unknown }) => (
  <div className={cn("flex size-full max-h-max min-w-72 flex-col gap-2 rounded-lg border p-4", className)} {...props}>
    <div className="flex flex-row gap-2">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <Skeleton className="h-10 w-full" />
    </div>
    <Skeleton className="h-20 w-full" />
  </div>
);

export const TweetNotFound = ({ className, ...props }: { className?: string; [key: string]: unknown }) => (
  <div
    className={cn("flex size-full flex-col items-center justify-center gap-2 rounded-lg border p-4", className)}
    {...props}
  >
    <h3>Tweet not found</h3>
  </div>
);

const logTweetError = (error: unknown, onError?: (error: Error) => void) => {
  const resolvedError = error instanceof Error ? error : new Error(String(error));

  if (onError) {
    onError(resolvedError);
    return;
  }

  console.error(resolvedError);
};

const TweetContent = ({ tweet, className, ...props }: { tweet: EnrichedTweet; className?: string }) => {
  return (
    <div
      className={cn(
        "relative flex w-full max-w-lg flex-col gap-2 rounded-lg p-4 backdrop-blur-md bg-neutral-100/50 dark:bg-neutral-800/20 border border-neutral-300/50 dark:border-neutral-800/50",
        className
      )}
      {...props}
    >
      <TweetHeader tweet={tweet} />
      <TweetBody tweet={tweet} />
      {/* {tweet.id_str !== "1920425974954381456" && (
        <div className="hidden sm:block">
          <TweetMedia tweet={tweet} />
        </div>
      )} */}
    </div>
  );
};

export const MagicTweet = ({ tweet, className, ...props }: { tweet: Tweet; className?: string }) => {
  const enrichedTweet = enrichTweet(tweet);

  return <TweetContent tweet={enrichedTweet} className={className} {...props} />;
};

/**
 * TweetCard (Server Side Only)
 */
export const TweetCard = async ({
  id,
  components,
  fallback = <TweetSkeleton />,
  onError,
  ...props
}: TweetProps & {
  className?: string;
}) => {
  const NotFound = components?.TweetNotFound || TweetNotFound;
  const notFound = <NotFound {...props} />;

  try {
    const tweet = id ? await getTweet(id) : undefined;

    if (!tweet) {
      return notFound;
    }

    const enrichedTweet = enrichTweet(tweet);

    return (
      <Suspense fallback={fallback}>
        <TweetErrorBoundary fallback={notFound} resetKey={id}>
          <TweetContent tweet={enrichedTweet} {...props} />
        </TweetErrorBoundary>
      </Suspense>
    );
  } catch (error) {
    logTweetError(error, onError);
    return notFound;
  }
};
