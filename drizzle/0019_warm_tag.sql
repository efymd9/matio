CREATE TABLE "guest_checkout_attempts" (
	"ip_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "guest_checkout_attempts_ip_hash_window_start_pk" PRIMARY KEY("ip_hash","window_start")
);
