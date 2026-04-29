class ApiConfig {
  const ApiConfig._();

  static const String baseUrl = String.fromEnvironment(
    'CISS_API_BASE_URL',
    defaultValue: 'https://cisskerala.site',
  );
}

