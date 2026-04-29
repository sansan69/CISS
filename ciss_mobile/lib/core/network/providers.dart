import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';

final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((Ref ref) {
  return ApiClient();
});

