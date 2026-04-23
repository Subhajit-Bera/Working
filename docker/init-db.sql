-- Initialize PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Grant necessary permissions
GRANT ALL PRIVILEGES ON DATABASE servanza TO postgres;