/*
 * El plan base es parte del esquema, no de los datos de prueba: sin él una
 * agencia nueva no puede existir. Idempotente, se reaplica en cada deploy.
 *
 * USD 100/mes con 5 usuarios incluidos; el sexto y siguientes, USD 20 cada uno.
 */
insert into plans (code, name, price_cents, currency, included_seats, extra_seat_price_cents, features)
values ('base', 'Cuasar Base', 10000, 'USD', 5, 2000,
        '{"publicSite": true, "customDomain": true, "integrations": false}'::jsonb)
on conflict (code) do update set
  name                   = excluded.name,
  price_cents            = excluded.price_cents,
  included_seats         = excluded.included_seats,
  extra_seat_price_cents = excluded.extra_seat_price_cents,
  features               = excluded.features;
